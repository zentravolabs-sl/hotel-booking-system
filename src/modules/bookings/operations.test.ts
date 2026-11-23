import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createBooking, createBookingSchema } from "./service";
import { computeBookingQuote, modifyBooking, cancelBooking } from "./operations";

const tag = `p3_${Date.now()}`;
let orgId = "", propertyId = "", cabanaId = "";

beforeAll(async () => {
  const o = await db.organization.create({ data: { name: tag, slug: tag } });
  orgId = o.id;
  const p = await db.property.create({
    data: {
      organizationId: orgId,
      name: "P3 Resort",
      slug: "p3-resort",
      settings: {
        create: {
          turnaroundMinutes: 30,
          holdMinutes: 15,
          taxPercent: 10,
          serviceChargePercent: 5,
          depositPercent: 30,
          cancellationPolicy: [{ hoursBefore: 48, chargePercent: 50 }],
        },
      },
    },
  });
  propertyId = p.id;
  const c = await db.cabana.create({ data: { organizationId: orgId, propertyId, code: "C-P3", name: "Lagoon Villa", maxAdults: 4 } });
  cabanaId = c.id;
  await db.ratePlan.create({
    data: {
      organizationId: orgId,
      propertyId,
      name: "Hourly Default",
      kind: "HOURLY",
      weekdayRate: "1000",
      weekendRate: "1500",
      extraAdultFee: "250",
      includedAdults: 2,
    },
  });
  await db.promoCode.create({
    data: { organizationId: orgId, code: `SAVE10_${tag}`.toUpperCase(), type: "PERCENT", value: "10.00" },
  });
});

afterAll(async () => {
  await db.bookingCharge.deleteMany({ where: { booking: { organizationId: orgId } } });
  await db.bookingItem.deleteMany({ where: { organizationId: orgId } });
  await db.booking.deleteMany({ where: { organizationId: orgId } });
  await db.guest.deleteMany({ where: { organizationId: orgId } });
  await db.promoCode.deleteMany({ where: { organizationId: orgId } });
  await db.ratePlan.deleteMany({ where: { organizationId: orgId } });
  await db.cabana.deleteMany({ where: { organizationId: orgId } });
  await db.organization.deleteMany({ where: { id: orgId } });
});

describe("Phase 3: Quote preview, modification & cancellation policy", () => {
  it("computes live quote with promo code, service charge, tax and deposit", async () => {
    const startAt = new Date(Date.UTC(2031, 2, 10, 5, 0)); // Monday
    const endAt = new Date(Date.UTC(2031, 2, 10, 7, 0)); // 2h -> 2000
    const q = await computeBookingQuote(orgId, {
      propertyId,
      cabanaIds: [cabanaId],
      type: "HOURLY",
      startAt,
      endAt,
      adults: 2,
      children: 0,
      extraBeds: 0,
      earlyCheckInHours: 0,
      lateCheckOutHours: 0,
      promoCode: `SAVE10_${tag}`.toUpperCase(),
    });
    // 2000 - 10% = 1800; +5% service (90) = 1890; +10% tax (189) = 2079
    expect(q.subtotal).toBe("2000.00");
    expect(q.discount).toBe("200.00");
    expect(q.serviceCharge).toBe("90.00");
    expect(q.tax).toBe("189.00");
    expect(q.total).toBe("2079.00");
  });

  it("modifies booking duration & reprices, then cancels with policy fee and frees the slot", async () => {
    const startAt = new Date(Date.UTC(2031, 2, 11, 5, 0));
    const endAt = new Date(Date.UTC(2031, 2, 11, 7, 0));
    const b = await createBooking(
      createBookingSchema.parse({
        propertyId,
        cabanaIds: [cabanaId],
        type: "HOURLY",
        startAt,
        endAt,
        adults: 2,
        guest: { firstName: "Maya", lastName: "Perera", email: `maya-${tag}@example.com` },
      }),
      { organizationId: orgId, userId: null, source: "WALK_IN" },
    );

    // Extend from 2h to 3h
    const updated = await modifyBooking(
      orgId,
      b.id,
      { endAt: new Date(Date.UTC(2031, 2, 11, 8, 0)) },
      null,
    );
    expect(Number(updated.subtotal)).toBe(3000);

    // Cancel 12 hours before startAt -> triggers 48h 50% cancellation policy fee
    const cancelTime = new Date(startAt.getTime() - 12 * 36e5);
    const cancelled = await cancelBooking(orgId, b.id, "Guest flight delayed", null, cancelTime);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.charges.some((c) => c.type === "CANCELLATION")).toBe(true);
    expect(cancelled.items.every((i) => i.blocking === false)).toBe(true);
  }, 60_000);
});

