import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  propertyId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  description: z.string().max(1000).optional(),
  price: z.number().min(0).max(100_000_000),
  inclusions: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
});

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("cabana:read");
  const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(searchParams(req));
  await assertPropertyAccess(ctx, propertyId);
  return ok(await db.package.findMany({ where: { organizationId: ctx.organizationId, propertyId, isActive: true }, orderBy: { createdAt: "desc" } }));
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("pricing:manage");
  const body = await parseBody(req, schema);
  await assertPropertyAccess(ctx, body.propertyId);
  const pkg = await db.package.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: body.propertyId,
      name: body.name,
      description: body.description,
      price: body.price.toFixed(2),
      inclusions: body.inclusions,
    },
  });
  await audit(ctx, "package.create", "Package", pkg.id);
  return ok(pkg, 201);
});

export const DELETE = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("pricing:manage");
  const { id } = z.object({ id: z.string().min(1) }).parse(searchParams(req));
  const res = await db.package.updateMany({ where: { id, organizationId: ctx.organizationId }, data: { isActive: false } });
  if (!res.count) throw notFound("Package not found");
  await audit(ctx, "package.deactivate", "Package", id);
  return ok({ deactivated: true });
});

