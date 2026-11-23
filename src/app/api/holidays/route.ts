import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, conflict, notFound } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit, isUniqueViolation } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  propertyId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  name: z.string().trim().min(2).max(80),
});

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("cabana:read");
  const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(searchParams(req));
  await assertPropertyAccess(ctx, propertyId);
  return ok(await db.holiday.findMany({ where: { propertyId }, orderBy: { date: "asc" } }));
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("pricing:manage");
  const body = await parseBody(req, schema);
  await assertPropertyAccess(ctx, body.propertyId);
  try {
    const h = await db.holiday.create({
      data: { propertyId: body.propertyId, name: body.name, date: new Date(`${body.date}T00:00:00.000Z`) },
    });
    await audit(ctx, "holiday.create", "Holiday", h.id);
    return ok(h, 201);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A holiday is already configured for that date");
    throw e;
  }
});

export const DELETE = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("pricing:manage");
  const { id } = z.object({ id: z.string().min(1) }).parse(searchParams(req));
  const h = await db.holiday.findUnique({ where: { id } });
  if (!h) throw notFound("Holiday not found");
  await assertPropertyAccess(ctx, h.propertyId);
  await db.holiday.delete({ where: { id } });
  await audit(ctx, "holiday.delete", "Holiday", id);
  return ok({ deleted: true });
});

