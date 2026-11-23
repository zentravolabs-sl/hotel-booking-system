import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, badRequest } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit } from "@/lib/http";

export const dynamic = "force-dynamic";

const money = z.number().min(0).max(100_000_000).transform((n) => n.toFixed(2));
const rateSchema = z.object({
  propertyId: z.string().min(1),
  cabanaId: z.string().nullable().optional(),
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["HOURLY", "DAY_USE", "OVERNIGHT"]),
  weekdayRate: money, weekendRate: money, holidayRate: money.nullable().optional(),
  extraAdultFee: money.default("0.00"), extraChildFee: money.default("0.00"), extraBedFee: money.default("0.00"),
  includedAdults: z.number().int().min(1).max(30).default(2),
  earlyCheckInFeePerHour: money.default("0.00"), lateCheckOutFeePerHour: money.default("0.00"),
  multiNightDiscountPercent: z.number().min(0).max(100).default(0),
  isCorporate: z.boolean().default(false),
});

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("cabana:read");
  const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(searchParams(req));
  await assertPropertyAccess(ctx, propertyId);
  return ok(await db.ratePlan.findMany({
    where: { organizationId: ctx.organizationId, propertyId, isActive: true },
    include: { seasonalRates: true, cabana: { select: { code: true, name: true } } },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
  }));
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("pricing:manage");
  const body = await parseBody(req, rateSchema);
  await assertPropertyAccess(ctx, body.propertyId);
  if (body.cabanaId && !(await db.cabana.findFirst({ where: { id: body.cabanaId, propertyId: body.propertyId, organizationId: ctx.organizationId } }))) throw badRequest("Unknown cabana");
  // One active plan per (property, cabana, kind) so pricing is never ambiguous.
  const dup = await db.ratePlan.findFirst({ where: { propertyId: body.propertyId, cabanaId: body.cabanaId ?? null, kind: body.kind, isActive: true, isCorporate: body.isCorporate } });
  if (dup) throw badRequest(`An active ${body.kind} rate already exists for this scope. Deactivate it first.`);
  const r = await db.ratePlan.create({ data: { ...body, cabanaId: body.cabanaId ?? null, organizationId: ctx.organizationId } });
  await audit(ctx, "ratePlan.create", "RatePlan", r.id);
  return ok(r, 201);
});

export const DELETE = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("pricing:manage");
  const { id } = z.object({ id: z.string().min(1) }).parse(searchParams(req));
  const res = await db.ratePlan.updateMany({ where: { id, organizationId: ctx.organizationId }, data: { isActive: false } });
  if (!res.count) throw badRequest("Rate plan not found");
  await audit(ctx, "ratePlan.deactivate", "RatePlan", id);
  return ok({ deactivated: true });
});
