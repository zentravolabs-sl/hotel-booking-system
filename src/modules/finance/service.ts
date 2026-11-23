import { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/api";
import { PayHereAdapter, type WebhookNotification } from "./payhere";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Idempotently record a payment against a booking (offline or verified gateway callback).
 * - Deduplicates on `(organizationId, idempotencyKey)` or `(provider, providerRef)`.
 * - Updates `booking.paidTotal` and `booking.paymentStatus` atomically.
 * - Promotes `PENDING` bookings to `CONFIRMED` once deposit or full payment arrives.
 */
export async function recordBookingPayment(params: {
  organizationId: string;
  bookingId: string;
  method: "CASH" | "BANK_TRANSFER" | "CARD" | "ONLINE";
  amount: Prisma.Decimal.Value;
  currency?: string;
  provider?: string;
  providerRef?: string;
  idempotencyKey?: string;
  receivedById?: string | null;
}) {
  const amt = D(params.amount).toDecimalPlaces(2);
  if (amt.lte(0)) throw badRequest("Payment amount must be positive");

  // Idempotency check before opening transaction
  if (params.provider && params.providerRef) {
    const existing = await db.payment.findUnique({
      where: { provider_providerRef: { provider: params.provider, providerRef: params.providerRef } },
    });
    if (existing) {
      const booking = params.bookingId
        ? await db.booking.findUnique({ where: { id: params.bookingId } })
        : null;
      return { payment: existing, booking, duplicate: true };
    }
  }
  if (params.idempotencyKey) {
    const existing = await db.payment.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: params.organizationId,
          idempotencyKey: params.idempotencyKey,
        },
      },
    });
    if (existing) {
      const booking = params.bookingId
        ? await db.booking.findUnique({ where: { id: params.bookingId } })
        : null;
      return { payment: existing, booking, duplicate: true };
    }
  }

  const b = await db.booking.findFirst({
    where: { id: params.bookingId, organizationId: params.organizationId },
  });
  if (!b) throw notFound("Booking not found");
  if (["CANCELLED", "EXPIRED"].includes(b.status)) {
    throw conflict("Cannot record payment for a cancelled or expired booking");
  }

  const receiptNo = `RCP-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomInt(100000, 999999)}`;

  return db.$transaction(
    async (tx) => {
      const payment = await tx.payment.create({
        data: {
          organizationId: params.organizationId,
          bookingId: b.id,
          method: params.method,
          status: "SUCCEEDED",
          amount: amt,
          currency: params.currency ?? "LKR",
          provider: params.provider ?? params.method,
          providerRef: params.providerRef ?? receiptNo,
          idempotencyKey: params.idempotencyKey ?? null,
          receiptNo,
          receivedById: params.receivedById ?? null,
          paidAt: new Date(),
        },
      });

      const newPaid = b.paidTotal.plus(amt);
      const paymentStatus = newPaid.gte(b.total) ? "PAID" : "PARTIALLY_PAID";
      const promoteHold =
        b.status === "PENDING" && (newPaid.gte(b.depositRequired) || newPaid.gte(b.total));

      const booking = await tx.booking.update({
        where: { id: b.id },
        data: {
          paidTotal: newPaid,
          paymentStatus,
          ...(promoteHold
            ? {
                status: "CONFIRMED",
                holdExpiresAt: null,
                history: {
                  create: {
                    fromStatus: "PENDING",
                    toStatus: "CONFIRMED",
                    note: `Confirmed via payment ${receiptNo}`,
                    changedById: params.receivedById ?? null,
                  },
                },
              }
            : {}),
        },
      });

      return { payment, booking, duplicate: false };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/**
 * Handle a server-to-server PayHere webhook callback.
 * - Verifies MD5 signature
 * - Matches booking by reference (`order_id`)
 * - Reconciles currency and positive amount
 * - Handles duplicate callbacks idempotently via `(provider="PAYHERE", providerRef=payment_id)`.
 */
export async function processPayHereWebhook(
  payload: WebhookNotification,
  adapter = new PayHereAdapter(),
) {
  const verified = adapter.verifyNotification(payload);
  if (!verified.valid) {
    throw badRequest("Invalid PayHere signature");
  }

  const booking = await db.booking.findUnique({
    where: { reference: verified.orderId },
    include: { property: true },
  });
  if (!booking) throw notFound("Booking reference not found");
  if (booking.property.currency.toUpperCase() !== verified.currency.toUpperCase()) {
    throw badRequest("Payment currency mismatch");
  }

  if (verified.status === "FAILED") {
    await db.booking.update({
      where: { id: booking.id },
      data: { paymentStatus: booking.paidTotal.gt(0) ? "PARTIALLY_PAID" : "FAILED" },
    });
    return { status: "FAILED" as const, duplicate: false };
  }

  if (verified.status === "PENDING") {
    return { status: "PENDING" as const, duplicate: false };
  }

  const res = await recordBookingPayment({
    organizationId: booking.organizationId,
    bookingId: booking.id,
    method: "ONLINE",
    amount: verified.amount,
    currency: verified.currency,
    provider: adapter.name,
    providerRef: verified.providerRef,
    idempotencyKey: `payhere:${verified.providerRef}`,
  });

  return { status: "SUCCEEDED" as const, duplicate: res.duplicate, paymentId: res.payment.id };
}

/**
 * Process a refund against a succeeded payment:
 * - Validates total refunds on that payment do not exceed `payment.amount`
 * - Decrements `booking.paidTotal` and transitions `booking.paymentStatus` (`PARTIALLY_REFUNDED` or `REFUNDED`).
 */
export async function createAndProcessRefund(params: {
  organizationId: string;
  paymentId: string;
  amount: Prisma.Decimal.Value;
  reason: string;
  approvedById: string | null;
}) {
  const amt = D(params.amount).toDecimalPlaces(2);
  if (amt.lte(0)) throw badRequest("Refund amount must be positive");

  const payment = await db.payment.findFirst({
    where: { id: params.paymentId, organizationId: params.organizationId, status: "SUCCEEDED" },
    include: { refunds: { where: { status: { in: ["APPROVED", "PROCESSED"] } } } },
  });
  if (!payment) throw notFound("Payment not found");

  const alreadyRefunded = payment.refunds.reduce((acc, r) => acc.plus(r.amount), D(0));
  const refundable = payment.amount.minus(alreadyRefunded);
  if (amt.gt(refundable)) {
    throw conflict(`Refund amount exceeds remaining refundable balance (${refundable.toFixed(2)})`, "EXCEEDS_PAID");
  }

  return db.$transaction(
    async (tx) => {
      const refund = await tx.refund.create({
        data: {
          organizationId: params.organizationId,
          paymentId: payment.id,
          amount: amt,
          reason: params.reason,
          status: "PROCESSED",
          approvedById: params.approvedById,
        },
      });

      if (payment.bookingId) {
        const b = await tx.booking.findUniqueOrThrow({ where: { id: payment.bookingId } });
        const nextPaid = Prisma.Decimal.max(D(0), b.paidTotal.minus(amt));
        const nextStatus = nextPaid.eq(0) ? "REFUNDED" : "PARTIALLY_REFUNDED";
        await tx.booking.update({
          where: { id: b.id },
          data: { paidTotal: nextPaid, paymentStatus: nextStatus },
        });
      }

      return refund;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/** Issue or retrieve an invoice for a booking. */
export async function issueBookingInvoice(organizationId: string, bookingId: string) {
  const existing = await db.invoice.findFirst({ where: { organizationId, bookingId } });
  if (existing) return existing;

  const b = await db.booking.findFirst({
    where: { id: bookingId, organizationId },
    include: {
      property: true,
      guest: true,
      items: { include: { cabana: { select: { code: true, name: true } } } },
      charges: true,
    },
  });
  if (!b) throw notFound("Booking not found");

  const number = `INV-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomInt(10000, 99999)}`;
  return db.invoice.create({
    data: {
      organizationId,
      bookingId: b.id,
      number,
      total: b.total,
      data: {
        reference: b.reference,
        propertyName: b.property.name,
        currency: b.property.currency,
        guestName: `${b.guest.firstName} ${b.guest.lastName}`,
        guestEmail: b.guest.email,
        guestPhone: b.guest.phone,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        subtotal: b.subtotal.toFixed(2),
        discountTotal: b.discountTotal.toFixed(2),
        serviceChargeTotal: b.serviceChargeTotal.toFixed(2),
        taxTotal: b.taxTotal.toFixed(2),
        total: b.total.toFixed(2),
        paidTotal: b.paidTotal.toFixed(2),
        items: b.items.map((i) => ({ code: i.cabana.code, name: i.cabana.name, price: i.price.toFixed(2) })),
        charges: b.charges.map((c) => ({ type: c.type, description: c.description, amount: c.amount.toFixed(2) })),
      },
    },
  });
}

/**
 * Financial & Profit/Loss summary for an organization (and optional property / date window).
 * CRITICAL REQUIREMENT: Never double-count booking revenue when advance payments and final settlements are recorded!
 * - `accruedBookingRevenue`: sum of `booking.total` for active/completed bookings (`CONFIRMED`, `CHECKED_IN`, `CHECKED_OUT`)
 *   + cancellation charges on `CANCELLED` bookings.
 * - `cashCollected` (treasury cash flow): sum of succeeded `Payment.amount` minus processed `Refund.amount`, reported separately from accrued revenue.
 * - `restaurantRevenue`: sum of non-cancelled `FoodOrder.total` where `chargedToRoom = false` (room-charged orders are already inside `booking.total` via `BookingCharge`).
 */
export async function computeFinancialSummary(params: {
  organizationId: string;
  propertyId?: string;
  from: Date;
  to: Date;
}) {
  const { organizationId, propertyId, from, to } = params;
  const propFilter = propertyId ? { propertyId } : {};

  const propBookingIds = propertyId
    ? (
        await db.booking.findMany({
          where: { organizationId, propertyId },
          select: { id: true },
        })
      ).map((b) => b.id)
    : undefined;

  const [bookings, cancellationCharges, standaloneOrders, expenses, payments, refunds] = await Promise.all([
    db.booking.findMany({
      where: {
        organizationId,
        ...propFilter,
        status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] },
        startAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        subtotal: true,
        discountTotal: true,
        serviceChargeTotal: true,
        taxTotal: true,
        total: true,
        paidTotal: true,
        charges: { select: { type: true, amount: true } },
      },
    }),
    db.bookingCharge.findMany({
      where: {
        type: "CANCELLATION",
        booking: {
          organizationId,
          ...propFilter,
          status: "CANCELLED",
          startAt: { gte: from, lte: to },
        },
      },
      select: { amount: true },
    }),
    db.foodOrder.findMany({
      where: {
        organizationId,
        ...propFilter,
        status: { not: "CANCELLED" },
        chargedToRoom: false,
        createdAt: { gte: from, lte: to },
      },
      select: { total: true },
    }),
    db.expense.findMany({
      where: {
        organizationId,
        ...propFilter,
        deletedAt: null,
        incurredOn: { gte: from, lte: to },
      },
      include: { category: { select: { name: true } } },
    }),
    db.payment.findMany({
      where: {
        organizationId,
        status: "SUCCEEDED",
        paidAt: { gte: from, lte: to },
        ...(propBookingIds ? { bookingId: { in: propBookingIds } } : {}),
      },
      select: { amount: true, method: true },
    }),
    db.refund.findMany({
      where: {
        organizationId,
        status: { in: ["APPROVED", "PROCESSED"] },
        createdAt: { gte: from, lte: to },
        ...(propBookingIds ? { payment: { bookingId: { in: propBookingIds } } } : {}),
      },
      select: { amount: true },
    }),
  ]);

  let bookingRevenue = D(0);
  let taxCollected = D(0);
  let serviceCharges = D(0);
  let extraServiceRevenue = D(0);
  let outstandingReceivables = D(0);

  for (const b of bookings) {
    bookingRevenue = bookingRevenue.plus(b.total);
    taxCollected = taxCollected.plus(b.taxTotal);
    serviceCharges = serviceCharges.plus(b.serviceChargeTotal);
    for (const c of b.charges) {
      extraServiceRevenue = extraServiceRevenue.plus(c.amount);
    }
    const due = b.total.minus(b.paidTotal);
    if (due.gt(0)) outstandingReceivables = outstandingReceivables.plus(due);
  }

  for (const c of cancellationCharges) {
    bookingRevenue = bookingRevenue.plus(c.amount);
  }

  const restaurantRevenue = standaloneOrders.reduce((acc, o) => acc.plus(o.total), D(0));
  const totalRevenue = bookingRevenue.plus(restaurantRevenue);
  const totalExpenses = expenses.reduce((acc, e) => acc.plus(e.amount), D(0));
  const netProfit = totalRevenue.minus(totalExpenses);

  const grossPayments = payments.reduce((acc, p) => acc.plus(p.amount), D(0));
  const totalRefunds = refunds.reduce((acc, r) => acc.plus(r.amount), D(0));
  const netCashCollected = grossPayments.minus(totalRefunds);

  const byMethod: Record<string, string> = {};
  for (const m of ["CASH", "CARD", "BANK_TRANSFER", "ONLINE"]) {
    const sum = payments.filter((p) => p.method === m).reduce((acc, p) => acc.plus(p.amount), D(0));
    byMethod[m] = sum.toFixed(2);
  }

  return {
    bookingRevenue: bookingRevenue.toFixed(2),
    extraServiceRevenue: extraServiceRevenue.toFixed(2),
    restaurantRevenue: restaurantRevenue.toFixed(2),
    totalRevenue: totalRevenue.toFixed(2),
    taxSummary: taxCollected.toFixed(2),
    serviceChargeSummary: serviceCharges.toFixed(2),
    totalExpenses: totalExpenses.toFixed(2),
    netProfit: netProfit.toFixed(2),
    outstandingReceivables: outstandingReceivables.toFixed(2),
    treasury: {
      grossPayments: grossPayments.toFixed(2),
      totalRefunds: totalRefunds.toFixed(2),
      netCashCollected: netCashCollected.toFixed(2),
      byMethod,
    },
  };
}
