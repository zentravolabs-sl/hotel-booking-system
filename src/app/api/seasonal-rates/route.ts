import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, badRequest, notFound } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  ratePlanId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  multiplier: z.number().min(0.1).max(10),
  isPeak: z.boolean().default(false),
  priority: z.number().int().min(0).max(100).default(0),
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("pricing:manage");
  const body = await parseBody(req, schema);
  if (body.endDate < body.startDate) throw badRequest("endDate must be on or after startDate");
  const plan = await db.ratePlan.findFirst({ where: { id: body.ratePlanId, organizationId: ctx.organizationId } });
  if (!plan) throw notFound("Rate plan not found");

  const s = await db.seasonalRate.create({
    data: {
      ratePlanId: body.ratePlanId,
      name: body.name,
      startDate: new Date(`${body.startDate}T00:00:00.000Z`),
      endDate: new Date(`${body.endDate}T00:00:00.000Z`),
      multiplier: body.multiplier.toFixed(3),
      isPeak: body.isPeak,
      priority: body.priority,
    },
  });
  await audit(ctx, "seasonalRate.create", "SeasonalRate", s.id);
  return ok(s, 201);
});

export const DELETE = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("pricing:manage");
  const { id } = z.object({ id: z.string().min(1) }).parse(searchParams(req));
  const s = await db.seasonalRate.findFirst({ where: { id, ratePlan: { organizationId: ctx.organizationId } } });
  if (!s) throw notFound("Seasonal rate not found");
  await db.seasonalRate.delete({ where: { id } });
  await audit(ctx, "seasonalRate.delete", "SeasonalRate", id);
  return ok({ deleted: true });
});

