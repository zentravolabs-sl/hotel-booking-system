import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, conflict, badRequest } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit, isUniqueViolation } from "@/lib/http";
import { cabanaSchema } from "@/modules/cabanas/schemas";
import { loadCabana } from "@/modules/cabanas/access";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

const patchSchema = cabanaSchema.omit({ propertyId: true }).partial();

export const GET = route(async (_req: Request, { params }: P) => {
  const ctx = await requirePermission("cabana:read");
  const { id } = await params;
  await loadCabana(ctx, id);
  const c = await db.cabana.findUniqueOrThrow({
    where: { id },
    include: {
      type: true, images: { orderBy: { sortOrder: "asc" } }, amenities: { include: { amenity: true } },
      history: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  return ok(c);
});

export const PATCH = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("cabana:manage");
  const { id } = await params;
  const existing = await loadCabana(ctx, id);
  const { amenityIds, typeId, bedConfig, ...data } = await parseBody(req, patchSchema);
  if (typeId && !(await db.cabanaType.findFirst({ where: { id: typeId, propertyId: existing.propertyId, deletedAt: null } }))) throw badRequest("Unknown cabana type");
  if (amenityIds) {
    const valid = await db.amenity.count({ where: { id: { in: amenityIds }, organizationId: ctx.organizationId } });
    if (valid !== amenityIds.length) throw badRequest("Unknown amenity");
  }
  const hourly = data.hourlyEnabled ?? existing.hourlyEnabled, overnight = data.overnightEnabled ?? existing.overnightEnabled;
  if (!hourly && !overnight) throw badRequest("Enable hourly and/or overnight booking");
  try {
    await db.$transaction(async (tx) => {
      await tx.cabana.update({
        where: { id },
        data: { ...data, ...(typeId !== undefined ? { typeId } : {}), ...(bedConfig ? { bedConfig } : {}) },
      });
      if (amenityIds) {
        await tx.cabanaAmenity.deleteMany({ where: { cabanaId: id } });
        await tx.cabanaAmenity.createMany({ data: amenityIds.map((amenityId) => ({ cabanaId: id, amenityId })) });
      }
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("That code is already used in this property");
    throw e;
  }
  await audit(ctx, "cabana.update", "Cabana", id);
  return ok(await db.cabana.findUniqueOrThrow({ where: { id } }));
});

/** DELETE archives (soft delete). Refused while future active bookings exist. */
export const DELETE = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("cabana:manage");
  const { id } = await params;
  const c = await loadCabana(ctx, id);
  const active = await db.bookingItem.count({
    where: { cabanaId: id, blocking: true, endAt: { gt: new Date() }, booking: { status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] } } },
  });
  if (active) throw conflict(`${active} upcoming booking(s) use this cabana. Move or cancel them first.`, "HAS_ACTIVE_BOOKINGS");
  await db.$transaction([
    db.cabana.update({ where: { id }, data: { archivedAt: new Date(), status: "INACTIVE", featured: false } }),
    db.cabanaStatusHistory.create({ data: { cabanaId: id, fromStatus: c.status, toStatus: "INACTIVE", reason: "Archived", changedById: ctx.userId } }),
  ]);
  await audit(ctx, "cabana.archive", "Cabana", id);
  return ok({ archived: true });
});

/** Restore an archived cabana (POST body {restore:true}). */
export const POST = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("cabana:manage");
  const { id } = await params;
  await loadCabana(ctx, id);
  await parseBody(req, z.object({ restore: z.literal(true) }));
  await db.cabana.update({ where: { id }, data: { archivedAt: null } });
  await audit(ctx, "cabana.restore", "Cabana", id);
  return ok({ restored: true });
});
