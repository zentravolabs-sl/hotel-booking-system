import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit } from "@/lib/http";
import { guestSchema, sanitizeGuest, assertSensitiveGuestWrite } from "@/modules/frontdesk/service";

export const dynamic = "force-dynamic";

const listSchema = z.object({
  q: z.string().trim().max(80).optional(),
  vip: z.enum(["true", "false"]).optional(),
  blacklisted: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("guest:read");
  const p = listSchema.parse(searchParams(req));
  const canSensitive = ctx.permissions.has("guest:sensitive");

  const where = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...(p.vip === "true" ? { isVip: true } : {}),
    ...(p.blacklisted === "true" ? { isBlacklisted: true } : {}),
    ...(p.q
      ? {
          OR: [
            { firstName: { contains: p.q, mode: "insensitive" as const } },
            { lastName: { contains: p.q, mode: "insensitive" as const } },
            { email: { contains: p.q, mode: "insensitive" as const } },
            { phone: { contains: p.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.guest.count({ where }),
    db.guest.findMany({
      where,
      orderBy: [{ isVip: "desc" }, { createdAt: "desc" }],
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
      include: { _count: { select: { bookings: true } } },
    }),
  ]);

  return ok(
    rows.map((g) => sanitizeGuest(g, canSensitive)),
    200,
    { page: p.page, pageSize: p.pageSize, total, canSensitive },
  );
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("guest:manage");
  const body = await parseBody(req, guestSchema);
  assertSensitiveGuestWrite(ctx, body);
  const g = await db.guest.create({
    data: {
      ...body,
      organizationId: ctx.organizationId,
      preferences: body.preferences ?? [],
    },
  });
  await audit(ctx, "guest.create", "Guest", g.id);
  return ok(sanitizeGuest(g, ctx.permissions.has("guest:sensitive")), 201);
});

