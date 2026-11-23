import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, conflict, notFound } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit, isUniqueViolation } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9-_]+$/, "Letters, numbers, - and _ only"),
  type: z.enum(["PERCENT", "FIXED"]),
  value: z.number().min(0.01).max(10_000_000),
  maxUses: z.number().int().min(1).max(100_000).nullable().optional(),
  minAmount: z.number().min(0).max(100_000_000).nullable().optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validTo: z.coerce.date().nullable().optional(),
});

export const GET = route(async () => {
  const ctx = await requirePermission("cabana:read");
  return ok(await db.promoCode.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { code: "asc" } }));
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("pricing:manage");
  const body = await parseBody(req, schema);
  if (body.type === "PERCENT" && body.value > 100) throw conflict("Percentage discount cannot exceed 100%");
  try {
    const p = await db.promoCode.create({
      data: {
        organizationId: ctx.organizationId,
        code: body.code.toUpperCase(),
        type: body.type,
        value: body.value.toFixed(2),
        maxUses: body.maxUses ?? null,
        minAmount: body.minAmount != null ? body.minAmount.toFixed(2) : null,
        validFrom: body.validFrom ?? null,
        validTo: body.validTo ?? null,
      },
    });
    await audit(ctx, "promo.create", "PromoCode", p.id);
    return ok(p, 201);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`Promo code "${body.code.toUpperCase()}" already exists`);
    throw e;
  }
});

export const DELETE = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("pricing:manage");
  const { id } = z.object({ id: z.string().min(1) }).parse(searchParams(req));
  const res = await db.promoCode.updateMany({ where: { id, organizationId: ctx.organizationId }, data: { isActive: false } });
  if (!res.count) throw notFound("Promo code not found");
  await audit(ctx, "promo.deactivate", "PromoCode", id);
  return ok({ deactivated: true });
});

