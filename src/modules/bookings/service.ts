import { Prisma, type BookingSource, type BookingType } from "@prisma/client";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, badRequest, notFound } from "@/lib/api";
import { calculatePrice, localDate, type PriceKind } from "@/modules/pricing/engine";

export const createBookingSchema = z
  .object({
    propertyId: z.string().min(1),
    cabanaIds: z.array(z.string().min(1)).min(1).max(20),
    type: z.enum(["HOURLY", "DAY_USE", "OVERNIGHT", "MULTI_NIGHT", "PACKAGE", "GROUP_BOOKING"]),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    adults: z.number().int().min(1).max(50),
    children: z.number().int().min(0).max(50).default(0),
    extraBeds: z.number().int().min(0).max(10).default(0),
    promoCode: z.string().trim().max(40).optional(),
    guest: z.object({
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(80),
      email: z.string().trim().email().optional(),
      phone: z.string().trim().min(5).max(30).optional(),
      nationality: z.string().max(60).optional(),
    }),
    specialRequests: z.string().max(1000).optional(),
  })
  .refine((v) => v.endAt > v.startAt, { message: "endAt must be after startAt", path: ["endAt"] });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;


const priceKindFor = (t: BookingType): PriceKind =>
  t === "HOURLY" ? "HOURLY" : t === "DAY_USE" ? "DAY_USE" : "OVERNIGHT";

function reference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[randomInt(alphabet.length)];
  return `CP-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${s}`;
}

/** Release holds whose TTL has passed. Safe to call any time; run inside booking txns and by the cron job. */
export async function expireStaleHolds(tx: Prisma.TransactionClient | typeof db = db, now = new Date()) {
  const stale = await tx.booking.findMany({
    where: { status: "PENDING", holdExpiresAt: { lt: now } },
    select: { id: true },
  });
  if (!stale.length) return 0;
  const ids = stale.map((b) => b.id);
  await tx.bookingItem.updateMany({ where: { bookingId: { in: ids } }, data: { blocking: false } });
  await tx.booking.updateMany({ where: { id: { in: ids }, status: "PENDING" }, data: { status: "EXPIRED" } });
  await tx.bookingStatusHistory.createMany({
    data: ids.map((bookingId) => ({ bookingId, fromStatus: "PENDING" as const, toStatus: "EXPIRED" as const, note: "Hold expired" })),
  });
  return ids.length;
}

function isOverlapError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("booking_item_no_overlap") || msg.includes("23P01") || msg.includes("conflicting key value violates exclusion");
}

export interface Actor {
  organizationId: string;
  userId: string | null;
  source: BookingSource;
}

/**
 * Creates a booking. Price is always computed server-side from DB rate plans.
 * Staff sources (WALK_IN/PHONE/ADMIN) are CONFIRMED immediately; WEBSITE/PARTNER bookings start as
 * PENDING with a time-limited hold. Overlaps are rejected by the DB exclusion constraint, so
 * correctness holds under any concurrency.
 */
export async function createBooking(input: CreateBookingInput, actor: Actor) {
  const property = await db.property.findFirst({
    where: { id: input.propertyId, organizationId: actor.organizationId, deletedAt: null },
    include: { settings: true },
  });
  if (!property) throw notFound("Property not found");
  const s = property.settings;
  const turnaround = s?.turnaroundMinutes ?? 30;
  const holdMinutes = s?.holdMinutes ?? 15;

  const cabanas = await db.cabana.findMany({
    where: { id: { in: input.cabanaIds }, propertyId: property.id, organizationId: actor.organizationId, archivedAt: null },
  });
  if (cabanas.length !== new Set(input.cabanaIds).size) throw notFound("One or more cabanas not found");
  for (const c of cabanas) {
    if (["MAINTENANCE", "INACTIVE"].includes(c.status)) throw conflict(`Cabana ${c.code} is not available for booking`, "CABANA_UNAVAILABLE");
    const hourly = input.type === "HOURLY" || input.type === "DAY_USE";
    if (hourly && !c.hourlyEnabled) throw badRequest(`Cabana ${c.code} does not accept hourly bookings`);
    if (!hourly && !c.overnightEnabled) throw badRequest(`Cabana ${c.code} does not accept overnight bookings`);
    if (input.cabanaIds.length === 1 && input.adults > c.maxAdults + input.extraBeds)
      throw badRequest(`Cabana ${c.code} allows at most ${c.maxAdults} adults`);
  }

  const kind = priceKindFor(input.type);
  const holidays = (await db.holiday.findMany({ where: { propertyId: property.id } })).map((h) => h.date.toISOString().slice(0, 10));

  let promo = null as Awaited<ReturnType<typeof db.promoCode.findFirst>>;
  if (input.promoCode) {
    const now = new Date();
    promo = await db.promoCode.findFirst({
      where: {
        organizationId: actor.organizationId, code: input.promoCode.toUpperCase(), isActive: true,
        AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: now } }] }, { OR: [{ validTo: null }, { validTo: { gte: now } }] }],
      },
    });
    if (!promo || (promo.maxUses != null && promo.usedCount >= promo.maxUses)) throw badRequest("Promo code is invalid or expired");
  }

  // Price each cabana, then total.
  let subtotal = new Prisma.Decimal(0), discount = new Prisma.Decimal(0), service = new Prisma.Decimal(0),
    tax = new Prisma.Decimal(0), total = new Prisma.Decimal(0), deposit = new Prisma.Decimal(0);
  const itemPrices: Record<string, Prisma.Decimal> = {};
  const snapshots: unknown[] = [];
  for (const c of cabanas) {
    const plan = await db.ratePlan.findFirst({
      where: {
        organizationId: actor.organizationId, propertyId: property.id, kind, isActive: true,
        OR: [{ cabanaId: c.id }, { cabanaId: null }],
      },
      orderBy: { cabanaId: { sort: "asc", nulls: "last" } }, // cabana-specific wins over property default
      include: { seasonalRates: true },
    });
    if (!plan) throw badRequest(`No ${kind} rate configured for cabana ${c.code}`);
    const b = calculatePrice({
      kind, startAt: input.startAt, endAt: input.endAt, timezone: property.timezone,
      rate: plan,
      seasons: plan.seasonalRates.map((r) => ({
        name: r.name, startDate: r.startDate.toISOString().slice(0, 10), endDate: r.endDate.toISOString().slice(0, 10),
        multiplier: r.multiplier, priority: r.priority,
      })),
      holidays, minHours: s?.minHours ?? 1,
      adults: Math.ceil(input.adults / cabanas.length), children: Math.ceil(input.children / cabanas.length),
      extraBeds: input.extraBeds,
      discount: promo ? { type: promo.type, value: promo.value } : null,
      taxPercent: s?.taxPercent ?? 0, serviceChargePercent: s?.serviceChargePercent ?? 0, depositPercent: s?.depositPercent ?? 0,
    });
    itemPrices[c.id] = new Prisma.Decimal(b.total);
    subtotal = subtotal.plus(b.subtotal); discount = discount.plus(b.discount); service = service.plus(b.serviceCharge);
    tax = tax.plus(b.tax); total = total.plus(b.total); deposit = deposit.plus(b.deposit);
    snapshots.push({ cabanaId: c.id, ...b });
  }

  const staff = ["WALK_IN", "PHONE", "ADMIN"].includes(actor.source);
  const status = staff ? "CONFIRMED" : "PENDING";
  const holdExpiresAt = staff ? null : new Date(Date.now() + holdMinutes * 60_000);
  const occupiedEnd = new Date(input.endAt.getTime() + turnaround * 60_000);

  try {
    return await db.$transaction(async (tx) => {
      await expireStaleHolds(tx);

      let guest = input.guest.email
        ? await tx.guest.findFirst({ where: { organizationId: actor.organizationId, email: input.guest.email, deletedAt: null } })
        : null;
      if (guest?.isBlacklisted) throw conflict("This guest cannot make bookings. Please contact the property.", "GUEST_BLOCKED");
      guest ??= await tx.guest.create({ data: { organizationId: actor.organizationId, ...input.guest } });

      const booking = await tx.booking.create({
        data: {
          organizationId: actor.organizationId, propertyId: property.id, reference: reference(),
          guestId: guest.id, type: input.type, source: actor.source, status,
          startAt: input.startAt, endAt: input.endAt, adults: input.adults, children: input.children,
          holdExpiresAt, subtotal, discountTotal: discount, serviceChargeTotal: service, taxTotal: tax, total,
          depositRequired: deposit, promoCodeId: promo?.id, priceSnapshot: snapshots as Prisma.InputJsonValue,
          specialRequests: input.specialRequests, createdById: actor.userId,
          items: {
            create: cabanas.map((c) => ({
              organizationId: actor.organizationId, cabanaId: c.id,
              startAt: input.startAt, endAt: occupiedEnd, blocking: true, price: itemPrices[c.id],
            })),
          },
          history: { create: { toStatus: status, note: `Created via ${actor.source}`, changedById: actor.userId } },
        },
        include: { items: true },
      });
      if (promo) await tx.promoCode.update({ where: { id: promo.id }, data: { usedCount: { increment: 1 } } });
      return booking;
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (e) {
    if (isOverlapError(e)) throw conflict("One of the selected cabanas is no longer available for that time.", "SLOT_TAKEN");
    throw e;
  }
}

/** Cabanas free for [startAt,endAt) (buffer applied), excluding maintenance/inactive. */
export async function findAvailableCabanas(propertyId: string, organizationId: string, startAt: Date, endAt: Date) {
  const prop = await db.property.findFirst({ where: { id: propertyId, organizationId }, include: { settings: true } });
  if (!prop) throw notFound("Property not found");
  const end = new Date(endAt.getTime() + (prop.settings?.turnaroundMinutes ?? 30) * 60_000);
  const now = new Date();
  return db.cabana.findMany({
    where: {
      propertyId, organizationId, archivedAt: null, status: { notIn: ["MAINTENANCE", "INACTIVE"] },
      NOT: {
        bookingItems: {
          some: {
            blocking: true, startAt: { lt: end }, endAt: { gt: startAt },
            booking: { OR: [{ status: { in: ["CONFIRMED", "CHECKED_IN"] } }, { status: "PENDING", holdExpiresAt: { gt: now } }] },
          },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });
}

export { localDate };
