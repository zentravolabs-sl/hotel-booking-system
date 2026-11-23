import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, conflict } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit, isUniqueViolation } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({ propertyId: z.string().min(1), name: z.string().trim().min(2).max(60), description: z.string().max(500).optional() });

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("cabana:read");
  const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(searchParams(req));
  await assertPropertyAccess(ctx, propertyId);
  return ok(await db.cabanaType.findMany({ where: { propertyId, deletedAt: null }, orderBy: { name: "asc" } }));
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("cabana:manage");
  const body = await parseBody(req, schema);
  await assertPropertyAccess(ctx, body.propertyId);
  try {
    const t = await db.cabanaType.create({ data: body });
    await audit(ctx, "cabanaType.create", "CabanaType", t.id);
    return ok(t, 201);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("This category already exists");
    throw e;
  }
});

