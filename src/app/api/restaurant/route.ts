import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, conflict } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit, isUniqueViolation } from "@/lib/http";
import { createPosOrder, updateOrderStatus } from "@/modules/pos/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("restaurant:read");
  const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(searchParams(req));
  await assertPropertyAccess(ctx, propertyId);

  const [categories, tables, orders, inHouseBookings] = await Promise.all([
    db.menuCategory.findMany({
      where: { organizationId: ctx.organizationId, propertyId },
      include: { items: { where: { deletedAt: null }, orderBy: { name: "asc" } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.restaurantTable.findMany({
      where: { organizationId: ctx.organizationId, propertyId },
      orderBy: { label: "asc" },
    }),
    db.foodOrder.findMany({
      where: { organizationId: ctx.organizationId, propertyId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    db.booking.findMany({
      where: { organizationId: ctx.organizationId, propertyId, status: "CHECKED_IN" },
      select: {
        id: true,
        reference: true,
        guest: { select: { firstName: true, lastName: true } },
        items: { include: { cabana: { select: { code: true, name: true } } } },
      },
      orderBy: { startAt: "asc" },
    }),
  ]);

  return ok({ categories, tables, orders, inHouseBookings });
});

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("menu_item"),
    propertyId: z.string().min(1),
    categoryName: z.string().trim().min(2).max(60),
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(300).optional(),
    price: z.number().min(0).max(10_000_000),
  }),
  z.object({
    action: z.literal("table"),
    propertyId: z.string().min(1),
    label: z.string().trim().min(1).max(30),
    seats: z.number().int().min(1).max(40).default(4),
  }),
  z.object({
    action: z.literal("order"),
    propertyId: z.string().min(1),
    type: z.enum(["DINE_IN", "TAKEAWAY", "ROOM_SERVICE"]),
    tableId: z.string().nullable().optional(),
    bookingId: z.string().nullable().optional(),
    chargeToRoom: z.boolean().default(false),
    discount: z.number().min(0).max(10_000_000).default(0),
    items: z
      .array(
        z.object({
          menuItemId: z.string().min(1),
          quantity: z.number().int().min(1).max(200),
          notes: z.string().max(200).optional(),
        }),
      )
      .min(1),
  }),
]);

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await parseBody(req, postSchema);

  if (body.action === "menu_item") {
    const ctx = await requirePermission("restaurant:manage");
    await assertPropertyAccess(ctx, body.propertyId);
    let cat = await db.menuCategory.findFirst({
      where: { organizationId: ctx.organizationId, propertyId: body.propertyId, name: body.categoryName },
    });
    cat ??= await db.menuCategory.create({
      data: { organizationId: ctx.organizationId, propertyId: body.propertyId, name: body.categoryName },
    });
    const item = await db.menuItem.create({
      data: {
        organizationId: ctx.organizationId,
        categoryId: cat.id,
        name: body.name,
        description: body.description,
        price: body.price.toFixed(2),
      },
    });
    await audit(ctx, "menuItem.create", "MenuItem", item.id);
    return ok(item, 201);
  }

  if (body.action === "table") {
    const ctx = await requirePermission("restaurant:manage");
    await assertPropertyAccess(ctx, body.propertyId);
    try {
      const tbl = await db.restaurantTable.create({
        data: { organizationId: ctx.organizationId, propertyId: body.propertyId, label: body.label, seats: body.seats },
      });
      return ok(tbl, 201);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict(`Table "${body.label}" already exists`);
      throw e;
    }
  }

  const ctx = await requirePermission("restaurant:order");
  await assertPropertyAccess(ctx, body.propertyId);
  const order = await createPosOrder({
    organizationId: ctx.organizationId,
    propertyId: body.propertyId,
    type: body.type,
    tableId: body.tableId,
    bookingId: body.bookingId,
    chargeToRoom: body.chargeToRoom,
    discount: body.discount,
    items: body.items,
    createdById: ctx.userId,
  });
  await audit(ctx, "posOrder.create", "FoodOrder", order.id, { number: order.number, chargedToRoom: order.chargedToRoom });
  return ok(order, 201);
});

const patchSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["PENDING", "ACCEPTED", "PREPARING", "READY", "SERVED", "CANCELLED"]),
});

export const PATCH = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("kitchen:manage");
  const body = await parseBody(req, patchSchema);
  const updated = await updateOrderStatus({
    organizationId: ctx.organizationId,
    orderId: body.orderId,
    status: body.status,
    userId: ctx.userId,
  });
  await audit(ctx, "posOrder.status", "FoodOrder", body.orderId, { status: body.status });
  return ok(updated);
});

