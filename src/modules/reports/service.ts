import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export async function generateAnalyticsAndReports(params: {
  organizationId: string;
  propertyId?: string;
  from: Date;
  to: Date;
}) {
  const { organizationId, propertyId, from, to } = params;
  const propFilter = propertyId ? { propertyId } : {};

  const [cabanas, bookings, expenses, payments, refunds, orders, employees] = await Promise.all([
    db.cabana.findMany({
      where: { organizationId, ...propFilter, archivedAt: null },
      select: { id: true, code: true, name: true, status: true },
    }),
    db.booking.findMany({
      where: {
        organizationId,
        ...propFilter,
        startAt: { gte: from, lte: to },
      },
      include: {
        guest: { select: { firstName: true, lastName: true, nationality: true, isVip: true } },
        items: { include: { cabana: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { startAt: "asc" },
    }),
    db.expense.findMany({
      where: {
        organizationId,
        ...propFilter,
        deletedAt: null,
        incurredOn: { gte: from, lte: to },
      },
      include: { category: { select: { name: true } } },
      orderBy: { incurredOn: "asc" },
    }),
    db.payment.findMany({
      where: {
        organizationId,
        status: "SUCCEEDED",
        paidAt: { gte: from, lte: to },
      },
      orderBy: { paidAt: "desc" },
    }),
    db.refund.findMany({
      where: {
        organizationId,
        status: { in: ["APPROVED", "PROCESSED"] },
        createdAt: { gte: from, lte: to },
      },
      include: { payment: { select: { receiptNo: true, method: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.foodOrder.findMany({
      where: {
        organizationId,
        ...propFilter,
        status: { not: "CANCELLED" },
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.employee.findMany({
      where: { organizationId, deletedAt: null },
      include: { department: { select: { name: true } }, _count: { select: { attendance: true, leaves: true } } },
    }),
  ]);

  const activeBookings = bookings.filter((b) => ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(b.status));

  // 1) Daily Revenue & Booking Trend
  const trendMap = new Map<string, { date: string; revenue: number; bookings: number }>();
  for (const b of activeBookings) {
    const day = b.startAt.toISOString().slice(0, 10);
    const cur = trendMap.get(day) ?? { date: day, revenue: 0, bookings: 0 };
    cur.revenue = Number(D(cur.revenue).plus(b.total).toFixed(2));
    cur.bookings += 1;
    trendMap.set(day, cur);
  }
  const revenueTrends = [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  // 2) Cabana Performance & Occupancy Analytics
  const windowDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 864e5));
  const cabanaPerfMap = new Map<string, { code: string; name: string; bookings: number; revenue: number; occupiedHours: number }>();
  for (const c of cabanas) {
    cabanaPerfMap.set(c.id, { code: c.code, name: c.name, bookings: 0, revenue: 0, occupiedHours: 0 });
  }
  for (const b of activeBookings) {
    const stayHours = Math.max(1, (b.endAt.getTime() - b.startAt.getTime()) / 36e5);
    for (const it of b.items) {
      const perf = cabanaPerfMap.get(it.cabanaId);
      if (perf) {
        perf.bookings += 1;
        perf.revenue = Number(D(perf.revenue).plus(it.price).toFixed(2));
        perf.occupiedHours = Number((perf.occupiedHours + stayHours).toFixed(1));
      }
    }
  }
  const cabanaPerformance = [...cabanaPerfMap.values()].map((c) => ({
    ...c,
    occupancyRate: Math.min(100, Math.round((c.occupiedHours / (windowDays * 12)) * 100)),
  }));

  const avgOccupancyRate =
    cabanaPerformance.length > 0
      ? Math.round(cabanaPerformance.reduce((a, c) => a + c.occupancyRate, 0) / cabanaPerformance.length)
      : 0;

  // 3) Booking Source Breakdown
  const sourceCounts = new Map<string, { source: string; count: number; revenue: number }>();
  for (const b of activeBookings) {
    const s = sourceCounts.get(b.source) ?? { source: b.source, count: 0, revenue: 0 };
    s.count += 1;
    s.revenue = Number(D(s.revenue).plus(b.total).toFixed(2));
    sourceCounts.set(b.source, s);
  }
  const bookingSources = [...sourceCounts.values()];

  // 4) Payment Methods Breakdown
  const methodMap = new Map<string, { method: string; amount: number; count: number }>();
  for (const p of payments) {
    const m = methodMap.get(p.method) ?? { method: p.method, amount: 0, count: 0 };
    m.amount = Number(D(m.amount).plus(p.amount).toFixed(2));
    m.count += 1;
    methodMap.set(p.method, m);
  }
  const paymentMethods = [...methodMap.values()];

  // 5) Expense Category Breakdown
  const expMap = new Map<string, { category: string; amount: number }>();
  for (const e of expenses) {
    const k = e.category.name;
    const cur = expMap.get(k) ?? { category: k, amount: 0 };
    cur.amount = Number(D(cur.amount).plus(e.amount).toFixed(2));
    expMap.set(k, cur);
  }
  const expenseAnalysis = [...expMap.values()];

  const totalBookingRev = activeBookings.reduce((a, b) => a.plus(b.total), D(0));
  const totalPosRev = orders.filter((o) => !o.chargedToRoom).reduce((a, o) => a.plus(o.total), D(0));
  const totalRev = totalBookingRev.plus(totalPosRev);
  const totalExp = expenses.reduce((a, e) => a.plus(e.amount), D(0));
  const outstanding = activeBookings.reduce((a, b) => a.plus(Prisma.Decimal.max(D(0), b.total.minus(b.paidTotal))), D(0));

  return {
    kpis: {
      totalCabanas: cabanas.length,
      availableCabanas: cabanas.filter((c) => c.status === "AVAILABLE").length,
      occupiedCabanas: cabanas.filter((c) => c.status === "OCCUPIED").length,
      periodBookings: activeBookings.length,
      periodRevenue: totalRev.toFixed(2),
      periodExpenses: totalExp.toFixed(2),
      netProfit: totalRev.minus(totalExp).toFixed(2),
      occupancyRate: avgOccupancyRate,
      outstandingPayments: outstanding.toFixed(2),
    },
    charts: {
      revenueTrends,
      cabanaPerformance,
      bookingSources,
      paymentMethods,
      expenseAnalysis,
    },
    tables: {
      bookings: bookings.map((b) => ({
        reference: b.reference,
        guest: `${b.guest.firstName} ${b.guest.lastName}`,
        type: b.type,
        source: b.source,
        status: b.status,
        paymentStatus: b.paymentStatus,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        total: b.total.toFixed(2),
        paidTotal: b.paidTotal.toFixed(2),
      })),
      expenses: expenses.map((e) => ({
        date: e.incurredOn.toISOString().slice(0, 10),
        category: e.category.name,
        description: e.description,
        amount: e.amount.toFixed(2),
      })),
      payments: payments.map((p) => ({
        receiptNo: p.receiptNo ?? "—",
        method: p.method,
        amount: p.amount.toFixed(2),
        paidAt: p.paidAt?.toISOString() ?? p.createdAt.toISOString(),
      })),
      refunds: refunds.map((r) => ({
        receiptNo: r.payment.receiptNo ?? "—",
        method: r.payment.method,
        amount: r.amount.toFixed(2),
        reason: r.reason ?? "—",
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      restaurant: orders.map((o) => ({
        number: o.number,
        type: o.type,
        status: o.status,
        chargedToRoom: o.chargedToRoom ? "Yes" : "No",
        total: o.total.toFixed(2),
        createdAt: o.createdAt.toISOString(),
      })),
      staff: employees.map((e) => ({
        employeeNo: e.employeeNo,
        name: e.name,
        department: e.department?.name ?? "—",
        position: e.position ?? "—",
        attendanceDays: e._count.attendance,
        leavesCount: e._count.leaves,
      })),
    },
  };
}

