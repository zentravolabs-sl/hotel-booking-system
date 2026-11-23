import { z } from "zod";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { route, ok, conflict } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit, isUniqueViolation } from "@/lib/http";
import { getInventorySnapshot, recordStockTransaction } from "@/modules/pos/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("inventory:read");
  const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(searchParams(req));
  await assertPropertyAccess(ctx, propertyId);
  return ok(await getInventorySnapshot(ctx.organizationId, propertyId));
});

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("product"),
    sku: z.string().trim().min(1).max(40),
    name: z.string().trim().min(2).max(120),
    categoryName: z.string().trim().max(60).optional(),
    unit: z.string().trim().min(1).max(20).default("pcs"),
    minStock: z.number().min(0).max(1_000_000).default(0),
    avgCost: z.number().min(0).max(100_000_000).default(0),
    isIngredient: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("transaction"),
    propertyId: z.string().min(1),
    productId: z.string().min(1),
    type: z.enum(["RECEIVE", "ISSUE", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT"]),
    quantity: z.number(),
    unitCost: z.number().min(0).max(100_000_000).optional(),
    reference: z.string().trim().max(80).optional(),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal("supplier"),
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().email().optional(),
  }),
  z.object({
    action: z.literal("purchase_order"),
    propertyId: z.string().min(1),
    supplierId: z.string().min(1),
    lines: z
      .array(
        z.object({
          productId: z.string().min(1),
          name: z.string(),
          quantity: z.number().min(0.001),
          unitCost: z.number().min(0),
        }),
      )
      .min(1),
  }),
]);

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("inventory:manage");
  const body = await parseBody(req, postSchema);

  if (body.action === "product") {
    let categoryId: string | null = null;
    if (body.categoryName) {
      const cat = await db.productCategory.upsert({
        where: { organizationId_name: { organizationId: ctx.organizationId, name: body.categoryName } },
        update: {},
        create: { organizationId: ctx.organizationId, name: body.categoryName },
      });
      categoryId = cat.id;
    }
    try {
      const prod = await db.product.create({
        data: {
          organizationId: ctx.organizationId,
          categoryId,
          sku: body.sku.toUpperCase(),
          name: body.name,
          unit: body.unit,
          minStock: body.minStock.toFixed(3),
          avgCost: body.avgCost.toFixed(2),
          isIngredient: body.isIngredient,
        },
      });
      await audit(ctx, "product.create", "Product", prod.id);
      return ok(prod, 201);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict(`SKU "${body.sku.toUpperCase()}" already exists`);
      throw e;
    }
  }

  if (body.action === "transaction") {
    await assertPropertyAccess(ctx, body.propertyId);
    const res = await recordStockTransaction({
      organizationId: ctx.organizationId,
      propertyId: body.propertyId,
      productId: body.productId,
      type: body.type,
      quantity: body.quantity,
      unitCost: body.unitCost,
      reference: body.reference,
      note: body.note,
      userId: ctx.userId,
    });
    await audit(ctx, "stockTx.record", "StockTransaction", res.transaction.id, {
      type: body.type,
      quantity: body.quantity,
    });
    return ok(res, 201);
  }

  if (body.action === "supplier") {
    const sup = await db.supplier.create({
      data: { organizationId: ctx.organizationId, name: body.name, phone: body.phone, email: body.email },
    });
    return ok(sup, 201);
  }

  await assertPropertyAccess(ctx, body.propertyId);
  const total = body.lines.reduce((acc, l) => acc + l.quantity * l.unitCost, 0);
  const number = `PO-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomInt(1000, 9999)}`;
  const po = await db.purchaseOrder.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: body.propertyId,
      supplierId: body.supplierId,
      number,
      status: "ORDERED",
      lines: body.lines,
      total: total.toFixed(2),
    },
  });
  await audit(ctx, "purchaseOrder.create", "PurchaseOrder", po.id);
  return ok(po, 201);
});

