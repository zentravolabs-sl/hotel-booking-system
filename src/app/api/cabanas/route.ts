import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, conflict, badRequest } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit, accessibleProperties, assertWithinPlan, isUniqueViolation } from "@/lib/http";
import { cabanaSchema } from "@/modules/cabanas/schemas";

export const dynamic = "force-dynamic";

const listSchema = z.object({
  propertyId: z.string().optional(),
  q: z.string().trim().max(60).optional(),
  status: z.enum(["AVAILABLE", "RESERVED", "OCCUPIED", "CLEANING", "MAINTENANCE", "INACTIVE"]).optional(),
  archived: z.enum(["true", "false"]).default("false"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(["name", "code", "createdAt", "sortOrder"]).default("sortOrder"),
  dir: z.enum(["asc", "desc"]).default("asc"),
});

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("cabana:read");
  const p = listSchema.parse(searchParams(req));
  if (p.propertyId) await assertPropertyAccess(ctx, p.propertyId);
  const ids = accessibleProperties(ctx);
  const where = {
    organizationId: ctx.organizationId,
    ...(p.propertyId ? { propertyId: p.propertyId } : ids ? { propertyId: { in: ids } } : {}),
    ...(p.status ? { status: p.status } : {}),
    archivedAt: p.archived === "true" ? { not: null } : null,
    ...(p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" as const } }, { code: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.cabana.count({ where }),
    db.cabana.findMany({
      where, orderBy: [{ [p.sort]: p.dir }, { code: "asc" }], skip: (p.page - 1) * p.pageSize, take: p.pageSize,
      include: { type: { select: { id: true, name: true } }, images: { orderBy: { sortOrder: "asc" }, take: 1 }, amenities: { include: { amenity: true } } },
    }),
  ]);
  return ok(rows, 200, { page: p.page, pageSize: p.pageSize, total });
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("cabana:manage");
  const { amenityIds, typeId, ...body } = await parseBody(req, cabanaSchema);
  await assertPropertyAccess(ctx, body.propertyId);
  await assertWithinPlan(ctx.organizationId, "cabanas");
  if (!body.hourlyEnabled && !body.overnightEnabled) throw badRequest("Enable hourly and/or overnight booking");
  if (typeId && !(await db.cabanaType.findFirst({ where: { id: typeId, propertyId: body.propertyId, deletedAt: null } }))) throw badRequest("Unknown cabana type");
  const valid = await db.amenity.count({ where: { id: { in: amenityIds }, organizationId: ctx.organizationId } });
  if (valid !== amenityIds.length) throw badRequest("Unknown amenity");
  try {
    const c = await db.cabana.create({
      data: {
        ...body, typeId: typeId ?? null, organizationId: ctx.organizationId, bedConfig: body.bedConfig as never,
        amenities: { create: amenityIds.map((amenityId) => ({ amenityId })) },
        history: { create: { toStatus: "AVAILABLE", reason: "Cabana created", changedById: ctx.userId } },
      },
    });
    await audit(ctx, "cabana.create", "Cabana", c.id);
    return ok(c, 201);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`Code "${body.code}" is already used in this property`);
    throw e;
  }
});

