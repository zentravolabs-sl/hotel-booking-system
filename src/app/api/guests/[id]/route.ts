import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit } from "@/lib/http";
import { guestSchema, sanitizeGuest, assertSensitiveGuestWrite } from "@/modules/frontdesk/service";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: P) => {
  const ctx = await requirePermission("guest:read");
  const { id } = await params;
  const g = await db.guest.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
    include: {
      bookings: {
        orderBy: { startAt: "desc" },
        take: 25,
        include: {
          property: { select: { name: true, currency: true } },
          items: { include: { cabana: { select: { code: true, name: true } } } },
        },
      },
    },
  });
  if (!g) throw notFound("Guest not found");
  return ok(sanitizeGuest(g, ctx.permissions.has("guest:sensitive")));
});

export const PATCH = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("guest:manage");
  const { id } = await params;
  const existing = await db.guest.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null } });
  if (!existing) throw notFound("Guest not found");
  const body = await parseBody(req, guestSchema.partial());
  assertSensitiveGuestWrite(ctx, body);
  const g = await db.guest.update({
    where: { id },
    data: {
      ...body,
      ...(body.preferences !== undefined ? { preferences: body.preferences } : {}),
    },
  });
  await audit(ctx, "guest.update", "Guest", id, { blacklisted: body.isBlacklisted });
  return ok(sanitizeGuest(g, ctx.permissions.has("guest:sensitive")));
});

