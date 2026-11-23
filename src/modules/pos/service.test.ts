import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createBooking, createBookingSchema } from "@/modules/bookings/service";
import { checkInBooking } from "@/modules/frontdesk/service";
import {
  createPosOrder,
  updateOrderStatus,
  recordStockTransaction,
  getInventorySnapshot,
} from "./service";

const tag = `p7_${Date.now()}`;
let orgId = "", propertyId = "", cabanaId = "", menuItemId = "", productId = "";

beforeAll(async () => {
  const o = await db.organization.create({ data: { name: tag, slug: tag } });
  orgId = o.id;
  const p = await db.property.create({
    data: { organizationId: orgId, name: "P7 Resort", slug: "p7-resort", settings: { create: {} } },
  });
  propertyId = p.id;
  const c = await db.cabana.create({ data: { organizationId: orgId, propertyId, code: "C-P7", name: "Coral Cabana" } });
  cabanaId = c.id;
  await db.ratePlan.create({
    data: { organizationId: orgId, propertyId, name: "Hourly", kind: "HOURLY", weekdayRate: "1000", weekendRate: "1000" },
  });
  const cat = await db.menuCategory.create({
    data: { organizationId: orgId, propertyId, name: "Grill" },
  });
  const item = await db.menuItem.create({
    data: { organizationId: orgId, categoryId: cat.id, name: "Seafood Platter", price: "3500.00" },
  });
  menuItemId = item.id;
  const prod = await db.product.create({
    data: {
      organizationId: orgId,
      sku: `SKU-${tag}`.toUpperCase(),
      name: "Tiger Prawns",
      unit: "kg",
      minStock: "5.000",
      avgCost: "2000.00",
      isIngredient: true,
    },
  });
  productId = prod.id;
});

afterAll(async () => {
  // StockTransaction has an immutability trigger on UPDATE/DELETE, so we temporarily disable our trigger only during test cleanup or leave org cascade cleanup if needed.
  await db.$executeRawUnsafe(`ALTER TABLE "StockTransaction" DISABLE TRIGGER stock_tx_immutable;`);
  await db.stockTransaction.deleteMany({ where: { organizationId: orgId } });
  await db.$executeRawUnsafe(`ALTER TABLE "StockTransaction" ENABLE TRIGGER stock_tx_immutable;`);
  await db.product.deleteMany({ where: { organizationId: orgId } });
  await db.orderItem.deleteMany({ where: { order: { organizationId: orgId } } });
  await db.foodOrder.deleteMany({ where: { organizationId: orgId } });
  await db.menuItem.deleteMany({ where: { organizationId: orgId } });
  await db.menuCategory.deleteMany({ where: { organizationId: orgId } });
  await db.bookingCharge.deleteMany({ where: { booking: { organizationId: orgId } } });
  await db.bookingItem.deleteMany({ where: { organizationId: orgId } });
  await db.booking.deleteMany({ where: { organizationId: orgId } });
  await db.guest.deleteMany({ where: { organizationId: orgId } });
  await db.ratePlan.deleteMany({ where: { organizationId: orgId } });
  await db.cabana.deleteMany({ where: { organizationId: orgId } });
  await db.organization.deleteMany({ where: { id: orgId } });
});

describe("Phase 7: Restaurant room-charge validation & immutable inventory transactions", () => {
  it("refuses room charging unless booking is CHECKED_IN, posts folio charge when CHECKED_IN, and reverses on order cancellation", async () => {
    const startAt = new Date(Date.UTC(2031, 6, 10, 6, 0));
    const endAt = new Date(Date.UTC(2031, 6, 10, 8, 0)); // 2000.00 room
    const b = await createBooking(
      createBookingSchema.parse({
        propertyId,
        cabanaIds: [cabanaId],
        type: "HOURLY",
        startAt,
        endAt,
        adults: 2,
        guest: { firstName: "Rohan", lastName: "Dias", email: `rohan-${tag}@example.com` },
      }),
      { organizationId: orgId, userId: null, source: "WALK_IN" },
    );

    // 1) Booking is CONFIRMED (not yet CHECKED_IN) -> room service MUST be rejected with BOOKING_NOT_ACTIVE
    await expect(
      createPosOrder({
        organizationId: orgId,
        propertyId,
        type: "ROOM_SERVICE",
        bookingId: b.id,
        items: [{ menuItemId, quantity: 1 }],
        createdById: null,
      }),
    ).rejects.toMatchObject({ code: "BOOKING_NOT_ACTIVE" });

    // 2) Check in guest -> now room charging succeeds and increments booking.total by 3500.00 (2000 -> 5500)
    await checkInBooking(orgId, b.id, null);
    const order = await createPosOrder({
      organizationId: orgId,
      propertyId,
      type: "ROOM_SERVICE",
      bookingId: b.id,
      items: [{ menuItemId, quantity: 1 }],
      createdById: null,
    });
    expect(order.chargedToRoom).toBe(true);
    expect(order.total.toFixed(2)).toBe("3500.00");

    const afterOrder = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(afterOrder.total.toFixed(2)).toBe("5500.00");

    // 3) Cancel order -> reverses folio charge back to 2000.00
    await updateOrderStatus({ organizationId: orgId, orderId: order.id, status: "CANCELLED", userId: null });
    const afterCancel = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(afterCancel.total.toFixed(2)).toBe("2000.00");
  }, 60_000);

  it("tracks stock receiving/issuing, prevents negative stock, and enforces immutable stock transaction history at the DB level", async () => {
    // Receive 10 kg @ 2200.00
    const rec = await recordStockTransaction({
      organizationId: orgId,
      propertyId,
      productId,
      type: "RECEIVE",
      quantity: 10,
      unitCost: 2200,
      reference: "GRN-01",
      userId: null,
    });
    expect(rec.onHand).toBe("10.000");

    // Issue 6 kg -> 4 kg left (below minStock 5.000 -> triggers low-stock alert)
    const iss = await recordStockTransaction({
      organizationId: orgId,
      propertyId,
      productId,
      type: "ISSUE",
      quantity: 6,
      reference: "KIT-01",
      userId: null,
    });
    expect(iss.onHand).toBe("4.000");

    // Attempting to issue 10 kg when only 4 kg on hand -> rejected with INSUFFICIENT_STOCK
    await expect(
      recordStockTransaction({
        organizationId: orgId,
        propertyId,
        productId,
        type: "ISSUE",
        quantity: 10,
        userId: null,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    const snap = await getInventorySnapshot(orgId, propertyId);
    expect(snap.lowStockCount).toBe(1);
    expect(snap.items[0].onHand).toBe("4.000");

    // Attempting to mutate or delete a StockTransaction row directly in PostgreSQL MUST fail due to stock_tx_immutable trigger!
    await expect(
      db.stockTransaction.update({ where: { id: rec.transaction.id }, data: { quantity: 999 } }),
    ).rejects.toThrow();
    await expect(
      db.stockTransaction.delete({ where: { id: rec.transaction.id } }),
    ).rejects.toThrow();
  }, 60_000);
});

