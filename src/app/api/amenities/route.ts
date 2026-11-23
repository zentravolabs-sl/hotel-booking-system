import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, conflict, notFound } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit, isUniqueViolation } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({ name: z.string().trim().min(2).max(50), icon: z.string().trim().max(40).optional() });

export const GET = route(async () => {
  const ctx = await requirePermission("cabana:read");
  return ok(await db.amenity.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: "asc" } }));
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("cabana:manage");
  const body = await parseBody(req, schema);
  try {
    const a = await db.amenity.create({ data: { ...body, organizationId: ctx.organizationId } });
    await audit(ctx, "amenity.create", "Amenity", a.id);
    return ok(a, 201);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("This amenity already exists");
    throw e;
  }
});

export const DELETE = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("cabana:manage");
  const { id } = z.object({ id: z.string().min(1) }).parse(Object.fromEntries(new URL(req.url).searchParams));
  const res = await db.amenity.deleteMany({ where: { id, organizationId: ctx.organizationId } });
  if (!res.count) throw notFound("Amenity not found");
  await audit(ctx, "amenity.delete", "Amenity", id);
  return ok({ deleted: true });
});

