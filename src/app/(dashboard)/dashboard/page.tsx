import Link from "next/link";
import {
  ArrowRight, BarChart3, Building2, CalendarCheck, CheckCircle2, Clock, ConciergeBell,
  DoorOpen, Home, PlusCircle, Sparkles, Tag, TrendingUp, UtensilsCrossed, Wrench,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/context";
import { accessibleProperties } from "@/lib/http";
import { Badge, Card, STATUS_TONE } from "@/components/ui/card";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireAuth();
  const org = ctx.organizationId;
  const ids = accessibleProperties(ctx);
  const propFilter = ids ? { propertyId: { in: ids } } : {};
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 864e5);

  const [
    properties,
    cabanas,
    available,
    maintenance,
    todayBookings,
    todayArrivals,
    todayDepartures,
    revAgg,
    ratePlanCount,
    recentBookings,
    cabanaList,
    dirtyTasksCount,
  ] = org
    ? await Promise.all([
        db.property.count({ where: { organizationId: org, deletedAt: null, ...(ids ? { id: { in: ids } } : {}) } }),
        db.cabana.count({ where: { organizationId: org, archivedAt: null, ...propFilter } }),
        db.cabana.count({ where: { organizationId: org, archivedAt: null, status: "AVAILABLE", ...propFilter } }),
        db.cabana.count({ where: { organizationId: org, archivedAt: null, status: { in: ["MAINTENANCE", "INACTIVE"] }, ...propFilter } }),
        db.booking.count({ where: { organizationId: org, createdAt: { gte: todayStart, lt: todayEnd }, ...propFilter } }),
        db.booking.count({ where: { organizationId: org, status: { in: ["CONFIRMED", "CHECKED_IN"] }, startAt: { gte: todayStart, lt: todayEnd }, ...propFilter } }),
        db.booking.count({ where: { organizationId: org, status: { in: ["CHECKED_IN", "CHECKED_OUT"] }, endAt: { gte: todayStart, lt: todayEnd }, ...propFilter } }),
        db.booking.aggregate({
          where: { organizationId: org, status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] }, ...propFilter },
          _sum: { total: true },
        }),
        db.ratePlan.count({ where: { organizationId: org, isActive: true, ...propFilter } }),
        db.booking.findMany({
          where: { organizationId: org, ...propFilter },
          include: {
            guest: { select: { firstName: true, lastName: true, isVip: true } },
            items: { include: { cabana: { select: { code: true } } } },
          },
          orderBy: { createdAt: "desc" },
          take: 6,
        }),
        db.cabana.findMany({
          where: { organizationId: org, archivedAt: null, ...propFilter },
          select: { id: true, code: true, name: true, status: true, cleaningStatus: true, zone: true },
          orderBy: { code: "asc" },
          take: 12,
        }),
        db.cleaningTask.count({
          where: { organizationId: org, status: { in: ["DIRTY", "IN_PROGRESS", "CLEAN"] }, ...propFilter },
        }),
      ])
    : [0, 0, 0, 0, 0, 0, 0, { _sum: { total: null } }, 0, [], [], 0];

  const cards = [
    { label: "Properties", value: properties, icon: Building2, tone: "bg-teal/10 text-teal" },
    { label: "Total cabanas", value: cabanas, icon: Home, tone: "bg-sky-500/10 text-sky-600" },
    { label: "Available now", value: available, icon: CheckCircle2, tone: "bg-emerald-500/10 text-emerald-600" },
    { label: "Out of service", value: maintenance, icon: Wrench, tone: "bg-amber-500/10 text-amber-600" },
    { label: "Today's bookings", value: todayBookings, icon: CalendarCheck, tone: "bg-indigo-500/10 text-indigo-600" },
    { label: "Today's arrivals", value: todayArrivals, icon: DoorOpen, tone: "bg-teal/10 text-teal" },
    { label: "Today's departures", value: todayDepartures, icon: Clock, tone: "bg-violet-500/10 text-violet-600" },
    { label: "Booked value", value: money(revAgg._sum.total?.toString() ?? "0"), icon: TrendingUp, tone: "bg-emerald-500/10 text-emerald-600" },
  ];

  const setupSteps = [
    { done: properties > 0, title: "1. Create Resort Property", href: "/dashboard/properties", cta: "Manage Properties" },
    { done: cabanas > 0, title: "2. Add Your Cabanas & Photos", href: "/dashboard/cabanas", cta: "Add Cabanas" },
    { done: ratePlanCount > 0, title: "3. Configure Hourly / Overnight Rates", href: "/dashboard/pricing", cta: "Set Pricing" },
    { done: recentBookings.length > 0, title: "4. Take Your First Reservation", href: "/dashboard/bookings", cta: "Create Booking" },
  ];
  const needsSetup = setupSteps.some((s) => !s.done);

  return (
    <div className="space-y-6">
      {/* Header + Quick Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Resort Operations Overview</h1>
          <p className="text-sm text-muted">Live property, cabana, arrival, departure and reservation metrics.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dashboard/front-desk"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2"
          >
            <ConciergeBell className="size-4 text-teal" /> Front Desk
          </Link>
          <Link
            href="/dashboard/bookings"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal px-4 text-sm font-medium text-white shadow-xs hover:bg-teal-600"
          >
            <PlusCircle className="size-4" /> Open Booking Calendar
          </Link>
        </div>
      </div>

      {/* 8 KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="flex items-center gap-4 p-5">
            <div className={`grid size-12 shrink-0 place-items-center rounded-xl ${c.tone}`}>
              <c.icon className="size-6" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{c.value}</p>
              <p className="text-sm text-muted">{c.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Quick-Start Onboarding Banner if cabanas or rates haven't been set up yet */}
      {needsSetup && (
        <Card className="border-teal/30 bg-gradient-to-r from-teal/5 via-surface to-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Quick-Start Resort Setup Checklist</h2>
              <p className="text-xs text-muted">Complete these steps so guests and front-desk staff can start booking cabanas.</p>
            </div>
            <Badge tone="green">
              {setupSteps.filter((s) => s.done).length} / {setupSteps.length} completed
            </Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {setupSteps.map((step) => (
              <Link
                key={step.title}
                href={step.href}
                className={`flex flex-col justify-between rounded-xl border p-3.5 text-xs transition ${
                  step.done
                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                    : "border-border bg-surface hover:border-teal"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{step.title}</span>
                  {step.done ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <ArrowRight className="size-4 shrink-0 text-teal" />
                  )}
                </div>
                <span className="mt-2 font-medium text-teal">{step.done ? "Completed" : step.cta} →</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Main Two-Column Operational Panels */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Reservations */}
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Recent Reservations</h2>
              <p className="text-xs text-muted">Latest online, walk-in and phone bookings across your properties.</p>
            </div>
            <Link href="/dashboard/bookings" className="text-xs font-medium text-teal hover:underline">
              View all →
            </Link>
          </div>

          {recentBookings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted">
              No reservations recorded yet.{" "}
              <Link href="/dashboard/bookings" className="font-medium text-teal hover:underline">
                Create your first reservation →
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-muted">
                  <tr>
                    {["Reference", "Guest", "Cabana(s)", "Dates", "Status", "Total"].map((h) => (
                      <th key={h} className="pb-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentBookings.map((b) => (
                    <tr key={b.id} className="border-b border-border last:border-0">
                      <td className="py-2.5 font-mono text-xs font-semibold">{b.reference}</td>
                      <td className="py-2.5 font-medium">
                        {b.guest.firstName} {b.guest.lastName}
                      </td>
                      <td className="py-2.5 text-xs text-muted">
                        {b.items.map((i) => i.cabana.code).join(", ")}
                      </td>
                      <td className="py-2.5 text-xs text-muted">
                        {new Date(b.startAt).toLocaleDateString()}
                      </td>
                      <td className="py-2.5">
                        <Badge tone={b.status === "CONFIRMED" || b.status === "CHECKED_OUT" ? "green" : b.status === "CHECKED_IN" ? "purple" : "amber"}>
                          {b.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 font-semibold">{money(b.total.toString())}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Live Cabana Readiness & Department Shortcuts */}
        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Cabana Live Board</h2>
              <Link href="/dashboard/cabanas" className="text-xs font-medium text-teal hover:underline">
                Manage →
              </Link>
            </div>
            {cabanaList.length === 0 ? (
              <p className="text-xs text-muted">
                No cabanas created yet.{" "}
                <Link href="/dashboard/cabanas" className="font-medium text-teal hover:underline">
                  Add a cabana →
                </Link>
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {cabanaList.map((c) => (
                  <div key={c.id} className="rounded-xl border border-border p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{c.code}</span>
                      <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-muted">{c.name}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="space-y-2.5 p-5">
            <h2 className="font-semibold">Workspace Shortcuts</h2>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Link href="/dashboard/housekeeping" className="flex items-center gap-2 rounded-xl border border-border p-2.5 font-medium hover:border-teal">
                <Sparkles className="size-4 text-teal" /> Housekeeping ({dirtyTasksCount})
              </Link>
              <Link href="/dashboard/restaurant" className="flex items-center gap-2 rounded-xl border border-border p-2.5 font-medium hover:border-teal">
                <UtensilsCrossed className="size-4 text-teal" /> Restaurant POS
              </Link>
              <Link href="/dashboard/pricing" className="flex items-center gap-2 rounded-xl border border-border p-2.5 font-medium hover:border-teal">
                <Tag className="size-4 text-teal" /> Rate Plans ({ratePlanCount})
              </Link>
              <Link href="/dashboard/reports" className="flex items-center gap-2 rounded-xl border border-border p-2.5 font-medium hover:border-teal">
                <BarChart3 className="size-4 text-teal" /> Analytics
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
