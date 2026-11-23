import { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/api";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Create a restaurant POS order (DINE_IN, TAKEAWAY, or ROOM_SERVICE).
 * CRITICAL REQUIREMENT: Room charges must be linked to a valid active guest booking (`CHECKED_IN` in the same property)!
 * - Always resolves menu item prices server-side from `MenuItem` rows.
 * - If `chargeToRoom === true`:
 *   - Verifies `bookingId` belongs to the same organization and property and has `status === "CHECKED_IN"`.
 *   - Atomically appends a `BookingCharge` (`type = "RESTAURANT"`) to the booking folio and updates `booking.total` and `booking.paymentStatus`.
 */
export async function createPosOrder(params: {
  organizationId: string;
  propertyId: string;
  type: "DINE_IN" | "TAKEAWAY" | "ROOM_SERVICE";
  tableId?: string | null;
  bookingId?: string | null;
  chargeToRoom?: boolean;
  discount?: Prisma.Decimal.Value;
  items: { menuItemId: string; quantity: number; notes?: string }[];
  createdById: string | null;
}) {
  if (!params.items.length) throw badRequest("Order must contain at least one item");

  const menuIds = [...new Set(params.items.map((i) => i.menuItemId))];
  const menuItems = await db.menuItem.findMany({
    where: {
      id: { in: menuIds },
      organizationId: params.organizationId,
      deletedAt: null,
      isAvailable: true,
    },
  });
  if (menuItems.length !== menuIds.length) {
    throw badRequest("One or more menu items are unavailable or invalid");
  }
  const byId = new Map(menuItems.map((m) => [m.id, m]));

  let subtotal = D(0);
  const orderLines = params.items.map((line) => {
    if (line.quantity < 1) throw badRequest("Quantity must be at least 1");
    const m = byId.get(line.menuItemId)!;
    subtotal = subtotal.plus(m.price.mul(line.quantity));
    return {
      menuItemId: m.id,
      name: m.name,
      quantity: line.quantity,
      unitPrice: m.price,
      notes: line.notes,
    };
  });

  const discount = Prisma.Decimal.min(D(params.discount ?? 0).toDecimalPlaces(2), subtotal);
  if (discount.lt(0)) throw badRequest("Discount cannot be negative");
  const total = subtotal.minus(discount).toDecimalPlaces(2);

  const shouldChargeRoom = Boolean(params.chargeToRoom || params.type === "ROOM_SERVICE");
  let activeBooking: Awaited<ReturnType<typeof db.booking.findFirst>> = null;

  if (shouldChargeRoom) {
    if (!params.bookingId) {
      throw badRequest("A checked-in guest booking is required for room service or room charging");
    }
    activeBooking = await db.booking.findFirst({
      where: {
        id: params.bookingId,
        organizationId: params.organizationId,
        propertyId: params.propertyId,
      },
    });
    if (!activeBooking) throw notFound("Guest booking not found for this property");
    if (activeBooking.status !== "CHECKED_IN") {
      throw conflict(
        `Room charges can only be posted to CHECKED_IN bookings (current status: ${activeBooking.status})`,
        "BOOKING_NOT_ACTIVE",
      );
    }
  }

  const number = `ORD-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomInt(10000, 99999)}`;

  return db.$transaction(
    async (tx) => {
      const order = await tx.foodOrder.create({
        data: {
          organizationId: params.organizationId,
          propertyId: params.propertyId,
          number,
          type: params.type,
          status: "PENDING",
          tableId: params.tableId ?? null,
          bookingId: activeBooking?.id ?? params.bookingId ?? null,
          chargedToRoom: shouldChargeRoom,
          subtotal,
          discount,
          total,
          createdById: params.createdById,
          items: { create: orderLines },
        },
        include: { items: true },
      });

      if (shouldChargeRoom && activeBooking) {
        await tx.bookingCharge.create({
          data: {
            bookingId: activeBooking.id,
            type: "RESTAURANT",
            description: `Restaurant Order ${number}`,
            quantity: 1,
            unitPrice: total,
            amount: total,
            createdById: params.createdById,
          },
        });
        const newTotal = activeBooking.total.plus(total);
        const nextPay = activeBooking.paidTotal.gte(newTotal)
          ? "PAID"
          : activeBooking.paidTotal.gt(0)
            ? "PARTIALLY_PAID"
            : "UNPAID";
        await tx.booking.update({
          where: { id: activeBooking.id },
          data: { total: newTotal, paymentStatus: nextPay },
        });
      }

      return order;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/**
 * Update Kitchen / POS order status (`PENDING` -> `ACCEPTED` -> `PREPARING` -> `READY` -> `SERVED` or `CANCELLED`).
 * - If a room-charged order is `CANCELLED`, reverses the `RESTAURANT` charge from the guest's booking folio.
 */
export async function updateOrderStatus(params: {
  organizationId: string;
  orderId: string;
  status: "PENDING" | "ACCEPTED" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";
  userId: string | null;
}) {
  const order = await db.foodOrder.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
  });
  if (!order) throw notFound("Order not found");
  if (order.status === "CANCELLED") throw conflict("Cancelled order cannot be updated");

  return db.$transaction(
    async (tx) => {
      const updated = await tx.foodOrder.update({
        where: { id: order.id },
        data: { status: params.status },
        include: { items: true },
      });

      if (params.status === "CANCELLED" && order.chargedToRoom && order.bookingId) {
        const b = await tx.booking.findUnique({ where: { id: order.bookingId } });
        if (b) {
          await tx.bookingCharge.create({
            data: {
              bookingId: b.id,
              type: "RESTAURANT",
              description: `Reversal: Cancelled Order ${order.number}`,
              quantity: 1,
              unitPrice: order.total.neg(),
              amount: order.total.neg(),
              createdById: params.userId,
            },
          });
          const nextTotal = Prisma.Decimal.max(D(0), b.total.minus(order.total));
          const nextPay = b.paidTotal.gte(nextTotal) ? "PAID" : b.paidTotal.gt(0) ? "PARTIALLY_PAID" : "UNPAID";
          await tx.booking.update({ where: { id: b.id }, data: { total: nextTotal, paymentStatus: nextPay } });
        }
      }

      return updated;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/**
 * Append an immutable stock transaction (`RECEIVE`, `ISSUE`, `ADJUSTMENT`, `TRANSFER_IN`, `TRANSFER_OUT`).
 * - Updates weighted average cost (`avgCost`) on `RECEIVE` when `unitCost` is provided.
 * - Prevents issuing or transferring more stock than currently on hand at the property.
 */
export async function recordStockTransaction(params: {
  organizationId: string;
  propertyId: string;
  productId: string;
  type: "RECEIVE" | "ISSUE" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT";
  quantity: Prisma.Decimal.Value;
  unitCost?: Prisma.Decimal.Value | null;
  reference?: string;
  note?: string;
  userId: string | null;
}) {
  const product = await db.product.findFirst({
    where: { id: params.productId, organizationId: params.organizationId, deletedAt: null },
  });
  if (!product) throw notFound("Product not found");

  const rawQty = D(params.quantity).toDecimalPlaces(3);
  if (rawQty.eq(0)) throw badRequest("Transaction quantity cannot be zero");

  // Signed quantity: RECEIVE / TRANSFER_IN are positive; ISSUE / TRANSFER_OUT are negative; ADJUSTMENT uses caller's sign.
  let signedQty = rawQty;
  if (params.type === "RECEIVE" || params.type === "TRANSFER_IN") {
    if (rawQty.lt(0)) throw badRequest("Receive / Transfer-In quantity must be positive");
    signedQty = rawQty;
  } else if (params.type === "ISSUE" || params.type === "TRANSFER_OUT") {
    signedQty = rawQty.abs().neg();
  }

  const agg = await db.stockTransaction.aggregate({
    where: { organizationId: params.organizationId, propertyId: params.propertyId, productId: product.id },
    _sum: { quantity: true },
  });
  const currentStock = agg._sum.quantity ?? D(0);
  const nextStock = currentStock.plus(signedQty);

  if (nextStock.lt(0)) {
    throw conflict(
      `Insufficient stock for ${product.name} (on hand: ${currentStock.toFixed(3)} ${product.unit})`,
      "INSUFFICIENT_STOCK",
    );
  }

  return db.$transaction(
    async (tx) => {
      if (params.type === "RECEIVE" && params.unitCost != null) {
        const unitCost = D(params.unitCost).toDecimalPlaces(2);
        const oldVal = Prisma.Decimal.max(D(0), currentStock).mul(product.avgCost);
        const newVal = signedQty.mul(unitCost);
        const denom = Prisma.Decimal.max(D(0), currentStock).plus(signedQty);
        const nextAvg = denom.gt(0) ? oldVal.plus(newVal).div(denom).toDecimalPlaces(2) : unitCost;
        await tx.product.update({ where: { id: product.id }, data: { avgCost: nextAvg } });
      }

      const txRow = await tx.stockTransaction.create({
        data: {
          organizationId: params.organizationId,
          propertyId: params.propertyId,
          productId: product.id,
          type: params.type,
          quantity: signedQty,
          unitCost: params.unitCost != null ? D(params.unitCost).toDecimalPlaces(2) : product.avgCost,
          reference: params.reference,
          note: params.note,
          createdById: params.userId,
        },
      });

      return { transaction: txRow, onHand: nextStock.toFixed(3) };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/** Compute current stock levels, minimum stock alerts, and total inventory valuation for a property. */
export async function getInventorySnapshot(organizationId: string, propertyId: string) {
  const [products, grouped, transactions, suppliers, purchaseOrders] = await Promise.all([
    db.product.findMany({
      where: { organizationId, deletedAt: null },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { sku: "asc" },
    }),
    db.stockTransaction.groupBy({
      by: ["productId"],
      where: { organizationId, propertyId },
      _sum: { quantity: true },
    }),
    db.stockTransaction.findMany({
      where: { organizationId, propertyId },
      include: { product: { select: { sku: true, name: true, unit: true } } },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    db.supplier.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { name: "asc" },
    }),
    db.purchaseOrder.findMany({
      where: { organizationId, propertyId },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const stockMap = new Map(grouped.map((g) => [g.productId, g._sum.quantity ?? D(0)]));
  let totalValuation = D(0);
  let lowStockCount = 0;

  const items = products.map((p) => {
    const onHand = stockMap.get(p.id) ?? D(0);
    const valuation = Prisma.Decimal.max(D(0), onHand).mul(p.avgCost).toDecimalPlaces(2);
    totalValuation = totalValuation.plus(valuation);
    const isLow = onHand.lte(p.minStock);
    if (isLow) lowStockCount++;
    return {
      ...p,
      onHand: onHand.toFixed(3),
      valuation: valuation.toFixed(2),
      isLow,
    };
  });

  return {
    items,
    totalValuation: totalValuation.toFixed(2),
    lowStockCount,
    transactions,
    suppliers,
    purchaseOrders,
  };
}

