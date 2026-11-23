import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createBooking, createBookingSchema } from "@/modules/bookings/service";
import { checkInBooking, checkOutBooking, sanitizeGuest } from "./service";

const tag = `p4_${Date.now()}`;
let orgId = "", propertyId = "", cabanaId = "";

beforeAll(async () => {
  const o = await db.organization.create({ data: { name: tag, slug: tag } });
  orgId = o.id;
  const p = await db.property.create({
    data: { organizationId: orgId, name: "P4 Beach", slug: "p4-beach", settings: { create: { turnaroundMinutes: 30 } } },
  });
  propertyId = p.id;
  const c = await db.cabana.create({ data: { organizationId: orgId, propertyId, code: "C-P4", name: "Ocean Cabana" } });
  cabanaId = c.id;
  await db.ratePlan.create({
    data: { organizationId: orgId, propertyId, name: "Hourly", kind: "HOURLY", weekdayRate: "1000", weekendRate: "1000" },
  });
});

afterAll(async () => {
  await db.cleaningTask.deleteMany({ where: { organizationId: orgId } });
  await db.bookingCharge.deleteMany({ where: { booking: { organizationId: orgId } } });
  await db.bookingItem.deleteMany({ where: { organizationId: orgId } });
  await db.booking.deleteMany({ where: { organizationId: orgId } });
  await db.guest.deleteMany({ where: { organizationId: orgId } });
  await db.ratePlan.deleteMany({ where: { organizationId: orgId } });
  await db.cabana.deleteMany({ where: { organizationId: orgId } });
  await db.organization.deleteMany({ where: { id: orgId } });
});

describe("Phase 4: Guest CRM privacy & Check-in / Check-out lifecycle", () => {
  it("masks NIC/Passport numbers and blacklist reason when caller lacks guest:sensitive", () => {
    const g = { idNumber: "199512345678", blacklistReason: "Unpaid damages" };
    expect(sanitizeGuest(g, false)).toEqual({ idNumber: "••••••••5678", blacklistReason: null });
    expect(sanitizeGuest(g, true)).toEqual(g);
  });

  it("checks in a booking (cabana -> OCCUPIED), then checks out (cabana -> CLEANING/DIRTY + CleaningTask created)", async () => {
    const startAt = new Date(Date.UTC(2031, 4, 10, 6, 0));
    const endAt = new Date(Date.UTC(2031, 4, 10, 8, 0));
    const b = await createBooking(
      createBookingSchema.parse({
        propertyId,
        cabanaIds: [cabanaId],
        type: "HOURLY",
        startAt,
        endAt,
        adults: 2,
        guest: { firstName: "Nimal", lastName: "Silva", email: `nimal-${tag}@example.com` },
      }),
      { organizationId: orgId, userId: null, source: "WALK_IN" },
    );

    const checkedIn = await checkInBooking(orgId, b.id, null, {
      idType: "NIC",
      idNumber: "921234567V",
      earlyCheckInFee: 500,
    });
    expect(checkedIn.status).toBe("CHECKED_IN");
    expect(Number(checkedIn.total)).toBe(2500);
    const cabDuring = await db.cabana.findUniqueOrThrow({ where: { id: cabanaId } });
    expect(cabDuring.status).toBe("OCCUPIED");

    // Attempt check-out without settling balance -> rejected with BALANCE_DUE
    await expect(checkOutBooking(orgId, b.id, null)).rejects.toMatchObject({ code: "BALANCE_DUE" });

    // Check-out with authorized unpaid override + late check-out fee
    const checkedOut = await checkOutBooking(orgId, b.id, null, {
      lateCheckOutFee: 300,
      allowUnpaidCheckout: true,
    });
    expect(checkedOut.status).toBe("CHECKED_OUT");
    expect(Number(checkedOut.total)).toBe(2800);

    // Cabana must NOT be AVAILABLE yet — must be CLEANING + DIRTY with an auto-created CleaningTask
    const cabAfter = await db.cabana.findUniqueOrThrow({ where: { id: cabanaId } });
    expect(cabAfter.status).toBe("CLEANING");
    expect(cabAfter.cleaningStatus).toBe("DIRTY");

    const tasks = await db.cleaningTask.findMany({ where: { bookingId: b.id, cabanaId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("DIRTY");
  }, 60_000);
});

