import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, conflict } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit } from "@/lib/http";
import { propertySchema } from "@/modules/properties/schemas";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const pct = z.number().min(0).max(100);
const settingsSchema = z.object({
  checkInTime: hhmm, checkOutTime: hhmm,
  turnaroundMinutes: z.number().int().min(0).max(240),
  holdMinutes: z.number().int().min(5).max(120),
  taxPercent: pct, serviceChargePercent: pct, depositPercent: pct,
  minHours: z.number().int().min(1).max(24),
  requireInspection: z.boolean(),
  cancellationPolicy: z.array(z.object({ hoursBefore: z.number().int().min(0), chargePercent: pct })).max(10),
}).partial();

const patchSchema = propertySchema.omit({ parentPropertyId: true }).partial().extend({ settings: settingsSchema.optional() });

export const GET = route(async (_req: Request, { params }: P) => {
  const ctx = await requirePermission("property:read");
  const { id } = await params;
  return ok(await assertPropertyAccess(ctx, id));
});

export const PATCH = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("property:manage");
  const { id } = await params;
  await assertPropertyAccess(ctx, id);
  const { settings, ...data } = await parseBody(req, patchSchema);
  const p = await db.property.update({
    where: { id },
    data: { ...data, ...(settings ? { settings: { upsert: { create: settings, update: settings } } } : {}) },
    include: { settings: true },
  });
  await audit(ctx, "property.update", "Property", id, { fields: Object.keys({ ...data, ...(settings ? { settings } : {}) }) });
  return ok(p);
});

export const DELETE = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("property:manage");
  const { id } = await params;
  await assertPropertyAccess(ctx, id);
  const active = await db.booking.count({ where: { propertyId: id, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }, endAt: { gt: new Date() } } });
  if (active) throw conflict(`${active} active booking(s) exist. Cancel or complete them first.`, "HAS_ACTIVE_BOOKINGS");
  await db.property.update({ where: { id }, data: { deletedAt: new Date(), isPublic: false } });
  await audit(ctx, "property.archive", "Property", id);
  return ok({ archived: true });
});
