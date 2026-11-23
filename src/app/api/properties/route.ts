import { db } from "@/lib/db";
import { route, ok, conflict } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit, accessibleProperties, assertWithinPlan, isUniqueViolation } from "@/lib/http";
import { ORG_WIDE_ROLES } from "@/lib/permissions";
import { propertySchema } from "@/modules/properties/schemas";

export const dynamic = "force-dynamic";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "property";

export const GET = route(async () => {
  const ctx = await requirePermission("property:read");
  const ids = accessibleProperties(ctx);
  const rows = await db.property.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null, ...(ids ? { id: { in: ids } } : {}) },
    include: { settings: true },
    orderBy: { createdAt: "asc" },
  });
  const counts = await db.cabana.groupBy({
    by: ["propertyId"], where: { organizationId: ctx.organizationId, archivedAt: null }, _count: true,
  });
  const map = new Map(counts.map((c) => [c.propertyId, c._count]));
  return ok(rows.map((p) => ({ ...p, cabanaCount: map.get(p.id) ?? 0 })));
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("property:manage");
  const body = await parseBody(req, propertySchema);
  await assertWithinPlan(ctx.organizationId, "properties");
  if (body.parentPropertyId) {
    const parent = await db.property.findFirst({ where: { id: body.parentPropertyId, organizationId: ctx.organizationId, deletedAt: null } });
    if (!parent) throw conflict("Parent property not found", "BAD_PARENT");
  }
  let slug = slugify(body.name);
  if (await db.property.findFirst({ where: { organizationId: ctx.organizationId, slug } })) slug += `-${Date.now().toString(36).slice(-4)}`;
  try {
    const p = await db.property.create({
      data: { ...body, slug, organizationId: ctx.organizationId, settings: { create: {} } },
      include: { settings: true },
    });
    if (!ORG_WIDE_ROLES.has(ctx.roleKey)) await db.userPropertyAssignment.create({ data: { userId: ctx.userId, propertyId: p.id } });
    await audit(ctx, "property.create", "Property", p.id);
    return ok(p, 201);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A property with this name already exists");
    throw e;
  }
});

