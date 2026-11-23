import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createBooking, createBookingSchema, findAvailableCabanas } from "./service";

// Integration test against the configured database. Creates and removes its own tenants.
const tag = `t${Date.now()}`;
let orgId = "", propertyId = "", cabanaId = "";
let org2 = "";

const slot = (startH: number, endH: number) => ({
  startAt: new Date(Date.UTC(2031, 0, 5, startH)), endAt: new Date(Date.UTC(2031, 0, 5, endH)),
});
const input = (startH: number, endH: number, n = 0) =>
  createBookingSchema.parse({
    propertyId, cabanaIds: [cabanaId], type: "HOURLY", ...slot(startH, endH), adults: 2,
    guest: { firstName: "Test", lastName: `G${n}`, email: `g${n}-${tag}@example.com` },
  });
const actor = (source: "WALK_IN" | "WEBSITE" = "WALK_IN") => ({ organizationId: orgId, userId: null, source });

beforeAll(async () => {
  const o = await db.organization.create({ data: { name: tag, slug: tag } });
  orgId = o.id;
  const o2 = await db.organization.create({ data: { name: tag + "b", slug: tag + "b" } });
  org2 = o2.id;
  const p = await db.property.create({ data: { organizationId: orgId, name: "P", slug: "p", settings: { create: { turnaroundMinutes: 30, holdMinutes: 15 } } } });
  propertyId = p.id;
  const c = await db.cabana.create({ data: { organizationId: orgId, propertyId, code: "C1", name: "Cabana 1" } });
  cabanaId = c.id;
  await db.ratePlan.create({ data: { organizationId: orgId, propertyId, name: "Hourly", kind: "HOURLY", weekdayRate: "1000", weekendRate: "1000" } });
});

afterAll(async () => {
  await db.bookingItem.deleteMany({ where: { organizationId: orgId } });
  await db.booking.deleteMany({ where: { organizationId: orgId } });
  await db.guest.deleteMany({ where: { organizationId: orgId } });
  await db.ratePlan.deleteMany({ where: { organizationId: orgId } });
  await db.cabana.deleteMany({ where: { organizationId: orgId } });
  await db.organization.deleteMany({ where: { id: { in: [orgId, org2] } } });
  await db.$disconnect();
});

describe("booking overlap prevention", () => {
  it("lets exactly one of many simultaneous bookings win", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => createBooking(input(2, 4, i), actor())));
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const r of rejected) expect(r.reason.code).toBe("SLOT_TAKEN");
  }, 60_000);

  it("rejects overlap including the turnaround buffer, allows back-to-back after it", async () => {
    // existing 02:00-04:00 (+30m buffer => 04:30). 04:15 start must fail; 04:30 start must work.
    await expect(createBooking({ ...input(0, 1), startAt: new Date(Date.UTC(2031, 0, 5, 4, 15)), endAt: new Date(Date.UTC(2031, 0, 5, 5, 15)) }, actor())).rejects.toMatchObject({ code: "SLOT_TAKEN" });
    const b = await createBooking({ ...input(0, 1, 50), startAt: new Date(Date.UTC(2031, 0, 5, 4, 30)), endAt: new Date(Date.UTC(2031, 0, 5, 5, 30)) }, actor());
    expect(b.status).toBe("CONFIRMED");
  });

  it("website bookings start as PENDING holds and expired holds free the slot", async () => {
    const h = await createBooking(input(10, 11, 60), actor("WEBSITE"));
    expect(h.status).toBe("PENDING");
    expect(h.holdExpiresAt).not.toBeNull();
    expect((await findAvailableCabanas(propertyId, orgId, ...(Object.values(slot(10, 11)) as [Date, Date]))).length).toBe(0);
    await db.booking.update({ where: { id: h.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const next = await createBooking(input(10, 11, 61), actor());
    expect(next.status).toBe("CONFIRMED");
    expect((await db.booking.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("EXPIRED");
  });

  it("cancelled bookings no longer block", async () => {
    const b = await createBooking(input(14, 15, 70), actor());
    await db.bookingItem.updateMany({ where: { bookingId: b.id }, data: { blocking: false } });
    await db.booking.update({ where: { id: b.id }, data: { status: "CANCELLED" } });
    await expect(createBooking(input(14, 15, 71), actor())).resolves.toBeTruthy();
  });

  it("refuses maintenance cabanas regardless of reservation state", async () => {
    await db.cabana.update({ where: { id: cabanaId }, data: { status: "MAINTENANCE" } });
    await expect(createBooking(input(20, 21, 80), actor())).rejects.toMatchObject({ code: "CABANA_UNAVAILABLE" });
    await db.cabana.update({ where: { id: cabanaId }, data: { status: "AVAILABLE" } });
  });
});

describe("tenant isolation", () => {
  it("cannot book another organization's property or cabana", async () => {
    await expect(createBooking(input(22, 23, 90), { organizationId: org2, userId: null, source: "WALK_IN" })).rejects.toMatchObject({ status: 404 });
  });
  it("database rejects overlapping blocking items even when bypassing the service", async () => {
    const b = await db.booking.findFirstOrThrow({ where: { organizationId: orgId, status: "CONFIRMED" }, include: { items: true } });
    await expect(
      db.bookingItem.create({ data: { bookingId: b.id, organizationId: orgId, cabanaId, startAt: b.items[0].startAt, endAt: b.items[0].endAt, price: 1 } }),
    ).rejects.toThrow();
  });
});

