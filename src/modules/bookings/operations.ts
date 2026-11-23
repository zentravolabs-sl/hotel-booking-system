import { Prisma, type BookingType } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, badRequest, notFound } from "@/lib/api";
import { calculatePrice, cancellationCharge, type PriceKind } from "@/modules/pricing/engine";
import { expireStaleHolds } from "./service";

const priceKindFor = (t: BookingType): PriceKind =>
  t === "HOURLY" ? "HOURLY" : t === "DAY_USE" ? "DAY_USE" : "OVERNIGHT";

export const previewQuoteSchema = z
  .object({
    propertyId: z.string().min(1),
    cabanaIds: z.array(z.string().min(1)).min(1).max(20),
    type: z.enum(["HOURLY", "DAY_USE", "OVERNIGHT", "MULTI_NIGHT", "PACKAGE", "GROUP_BOOKING"]),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    adults: z.number().int().min(1).max(50),
    children: z.number().int().min(0).max(50).default(0),
    extraBeds: z.number().int().min(0).max(10).default(0),
    earlyCheckInHours: z.number().int().min(0).max(12).default(0),
    lateCheckOutHours: z.number().int().min(0).max(12).default(0),
    promoCode: z.string().trim().max(40).optional(),
  })
  .refine((v) => v.endAt > v.startAt, { message: "endAt must be after startAt", path: ["endAt"] });

export type PreviewQuoteInput = z.infer<typeof previewQuoteSchema>;

/** Compute a complete price breakdown for one or more cabanas without writing to the database. */
export async function computeBookingQuote(organizationId: string, input: PreviewQuoteInput) {
  const property = await db.property.findFirst({
    where: { id: input.propertyId, organizationId, deletedAt: null },
    include: { settings: true },
  });
  if (!property) throw notFound("Property not found");
  const s = property.settings;

  const cabanas = await db.cabana.findMany({
    where: { id: { in: input.cabanaIds }, propertyId: property.id, organizationId, archivedAt: null },
  });
  if (cabanas.length !== new Set(input.cabanaIds).size) throw notFound("One or more cabanas not found");

  const kind = priceKindFor(input.type);
  const holidays = (await db.holiday.findMany({ where: { propertyId: property.id } })).map((h) =>
    h.date.toISOString().slice(0, 10),
  );

  let promo = null as Awaited<ReturnType<typeof db.promoCode.findFirst>>;
  if (input.promoCode) {
    const now = new Date();
    promo = await db.promoCode.findFirst({
      where: {
        organizationId,
        code: input.promoCode.toUpperCase(),
        isActive: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        ],
      },
    });
    if (!promo || (promo.maxUses != null && promo.usedCount >= promo.maxUses))
      throw badRequest("Promo code is invalid or expired");
  }

  let subtotal = new Prisma.Decimal(0),
    discount = new Prisma.Decimal(0),
    service = new Prisma.Decimal(0),
    tax = new Prisma.Decimal(0),
    total = new Prisma.Decimal(0),
    deposit = new Prisma.Decimal(0);
  const items: { cabanaId: string; code: string; name: string; breakdown: ReturnType<typeof calculatePrice> }[] = [];

  for (const c of cabanas) {
    const plan = await db.ratePlan.findFirst({
      where: {
        organizationId,
        propertyId: property.id,
        kind,
        isActive: true,
        OR: [{ cabanaId: c.id }, { cabanaId: null }],
      },
      orderBy: { cabanaId: { sort: "asc", nulls: "last" } },
      include: { seasonalRates: true },
    });
    if (!plan) throw badRequest(`No ${kind} rate configured for cabana ${c.code}`);

    const b = calculatePrice({
      kind,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: property.timezone,
      rate: plan,
      seasons: plan.seasonalRates.map((r) => ({
        name: r.name,
        startDate: r.startDate.toISOString().slice(0, 10),
        endDate: r.endDate.toISOString().slice(0, 10),
        multiplier: r.multiplier,
        priority: r.priority,
      })),
      holidays,
      minHours: s?.minHours ?? 1,
      adults: Math.ceil(input.adults / cabanas.length),
      children: Math.ceil(input.children / cabanas.length),
      extraBeds: input.extraBeds,
      earlyCheckInHours: input.earlyCheckInHours,
      lateCheckOutHours: input.lateCheckOutHours,
      discount: promo ? { type: promo.type, value: promo.value } : null,
      taxPercent: s?.taxPercent ?? 0,
      serviceChargePercent: s?.serviceChargePercent ?? 0,
      depositPercent: s?.depositPercent ?? 0,
    });

    subtotal = subtotal.plus(b.subtotal);
    discount = discount.plus(b.discount);
    service = service.plus(b.serviceCharge);
    tax = tax.plus(b.tax);
    total = total.plus(b.total);
    deposit = deposit.plus(b.deposit);
    items.push({ cabanaId: c.id, code: c.code, name: c.name, breakdown: b });
  }

  if (promo?.minAmount && subtotal.lt(promo.minAmount)) {
    throw badRequest(`Promo code requires a minimum subtotal of ${promo.minAmount}`);
  }

  return {
    currency: property.currency,
    timezone: property.timezone,
    items,
    subtotal: subtotal.toFixed(2),
    discount: discount.toFixed(2),
    serviceCharge: service.toFixed(2),
    tax: tax.toFixed(2),
    total: total.toFixed(2),
    deposit: deposit.toFixed(2),
  };
}

/** Cancel a booking, release cabana blocks, and record any applicable cancellation charge. */
export async function cancelBooking(
  organizationId: string,
  bookingId: string,
  reason: string,
  userId: string | null,
  now = new Date(),
) {
  const b = await db.booking.findFirst({
    where: { id: bookingId, organizationId },
    include: { property: { include: { settings: true } } },
  });
  if (!b) throw notFound("Booking not found");
  if (["CANCELLED", "CHECKED_OUT", "EXPIRED"].includes(b.status))
    throw conflict(`Booking cannot be cancelled from ${b.status} status`);
  if (b.status === "CHECKED_IN")
    throw conflict("Checked-in bookings must be checked out rather than cancelled");

  const rawPolicy = b.property.settings?.cancellationPolicy;
  const policy = Array.isArray(rawPolicy)
    ? (rawPolicy as { hoursBefore: number; chargePercent: number }[])
    : [];
  const fee = cancellationCharge(b.total, b.startAt, now, policy);

  return db.$transaction(
    async (tx) => {
      await tx.bookingItem.updateMany({ where: { bookingId: b.id }, data: { blocking: false } });
      if (fee.gt(0)) {
        await tx.bookingCharge.create({
          data: {
            bookingId: b.id,
            type: "CANCELLATION",
            description: "Cancellation charge per property policy",
            quantity: 1,
            unitPrice: fee,
            amount: fee,
            createdById: userId,
          },
        });
      }
      const nextPayStatus =
        b.paidTotal.gt(fee) ? "REFUND_PENDING" : b.paymentStatus;
      return tx.booking.update({
        where: { id: b.id },
        data: {
          status: "CANCELLED",
          paymentStatus: nextPayStatus,
          cancelledAt: now,
          cancelReason: reason,
          history: {
            create: {
              fromStatus: b.status,
              toStatus: "CANCELLED",
              note: `${reason}${fee.gt(0) ? ` (Cancellation fee: ${fee.toFixed(2)})` : ""}`,
              changedById: userId,
            },
          },
        },
        include: { guest: true, items: { include: { cabana: true } }, history: true, charges: true },
      });
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

export const modifyBookingSchema = z.object({
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  adults: z.number().int().min(1).max(50).optional(),
  children: z.number().int().min(0).max(50).optional(),
  specialRequests: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(["CONFIRMED", "NO_SHOW"]).optional(),
});

/** Modify dates, guest counts, notes, or confirm a PENDING hold / mark NO_SHOW. Re-prices if dates or guest counts change. */
export async function modifyBooking(
  organizationId: string,
  bookingId: string,
  patch: z.infer<typeof modifyBookingSchema>,
  userId: string | null,
) {
  const existing = await db.booking.findFirst({
    where: { id: bookingId, organizationId },
    include: { items: true, property: { include: { settings: true } } },
  });
  if (!existing) throw notFound("Booking not found");
  if (["CANCELLED", "CHECKED_OUT", "EXPIRED"].includes(existing.status))
    throw conflict(`Cannot modify a ${existing.status} booking`);

  const startAt = patch.startAt ?? existing.startAt;
  const endAt = patch.endAt ?? existing.endAt;
  if (endAt <= startAt) throw badRequest("endAt must be after startAt");

  const adults = patch.adults ?? existing.adults;
  const children = patch.children ?? existing.children;
  const datesOrGuestsChanged =
    startAt.getTime() !== existing.startAt.getTime() ||
    endAt.getTime() !== existing.endAt.getTime() ||
    adults !== existing.adults ||
    children !== existing.children;

  const turnaround = existing.property.settings?.turnaroundMinutes ?? 30;
  const occupiedEnd = new Date(endAt.getTime() + turnaround * 60_000);
  const cabanaIds = existing.items.map((it) => it.cabanaId);

  const quote = datesOrGuestsChanged
    ? await computeBookingQuote(organizationId, {
        propertyId: existing.propertyId,
        cabanaIds,
        type: existing.type,
        startAt,
        endAt,
        adults,
        children,
        extraBeds: 0,
        earlyCheckInHours: 0,
        lateCheckOutHours: 0,
      })
    : null;

  try {
    return await db.$transaction(
      async (tx) => {
        await expireStaleHolds(tx);
        if (datesOrGuestsChanged) {
          for (const it of existing.items) {
            const itemQuote = quote!.items.find((q) => q.cabanaId === it.cabanaId);
            await tx.bookingItem.update({
              where: { id: it.id },
              data: {
                startAt,
                endAt: occupiedEnd,
                price: itemQuote ? new Prisma.Decimal(itemQuote.breakdown.total) : it.price,
              },
            });
          }
        }
        const nextStatus = patch.status ?? existing.status;
        const blocking = nextStatus !== "NO_SHOW";
        if (!blocking) {
          await tx.bookingItem.updateMany({ where: { bookingId: existing.id }, data: { blocking: false } });
        }
        return tx.booking.update({
          where: { id: existing.id },
          data: {
            startAt,
            endAt,
            adults,
            children,
            ...(patch.specialRequests !== undefined ? { specialRequests: patch.specialRequests } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
            ...(patch.status ? { status: patch.status, holdExpiresAt: null } : {}),
            ...(quote
              ? {
                  subtotal: new Prisma.Decimal(quote.subtotal),
                  discountTotal: new Prisma.Decimal(quote.discount),
                  serviceChargeTotal: new Prisma.Decimal(quote.serviceCharge),
                  taxTotal: new Prisma.Decimal(quote.tax),
                  total: new Prisma.Decimal(quote.total),
                  depositRequired: new Prisma.Decimal(quote.deposit),
                }
              : {}),
            history:
              patch.status || datesOrGuestsChanged
                ? {
                    create: {
                      fromStatus: existing.status,
                      toStatus: nextStatus,
                      note: datesOrGuestsChanged ? "Booking dates/guests modified" : `Status updated to ${nextStatus}`,
                      changedById: userId,
                    },
                  }
                : undefined,
          },
          include: { guest: true, items: { include: { cabana: true } }, history: true, charges: true },
        });
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("booking_item_no_overlap") || msg.includes("23P01") || msg.includes("exclusion")) {
      throw conflict("New dates conflict with another reservation on one of the cabanas", "SLOT_TAKEN");
    }
    throw e;
  }
}

