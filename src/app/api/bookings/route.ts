import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, HttpError } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { createBooking, createBookingSchema } from "@/modules/bookings/service";

const sourceSchema = z.enum(["WALK_IN", "PHONE", "ADMIN"]).default("ADMIN");

// organizationId / userId / price are never read from the body — they come from the session and server pricing.
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("booking:create");
  const raw = await req.json();
  const { source: rawSource, ...rest } = raw;
  const input = createBookingSchema.parse(rest);
  await assertPropertyAccess(ctx, input.propertyId);
  const booking = await createBooking(input, { organizationId: ctx.organizationId, userId: ctx.userId, source: sourceSchema.parse(rawSource) });
  await db.auditLog.create({ data: { organizationId: ctx.organizationId, userId: ctx.userId, action: "booking.create", entity: "Booking", entityId: booking.id } });
  return ok(booking, 201);
});

const listSchema = z.object({
  propertyId: z.string().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW", "EXPIRED"]).optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["startAt", "createdAt", "total"]).default("startAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("booking:read");
  const p = listSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  if (p.propertyId) await assertPropertyAccess(ctx, p.propertyId);
  const where = {
    organizationId: ctx.organizationId, // tenant filter always applied
    ...(p.propertyId ? { propertyId: p.propertyId } : {}),
    ...(p.status ? { status: p.status } : {}),
    ...(p.q ? { OR: [{ reference: { contains: p.q, mode: "insensitive" as const } }, { guest: { lastName: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.booking.count({ where }),
    db.booking.findMany({
      where, orderBy: { [p.sort]: p.dir }, skip: (p.page - 1) * p.pageSize, take: p.pageSize,
      include: { guest: { select: { firstName: true, lastName: true } }, items: { select: { cabanaId: true } } },
    }),
  ]);
  return ok(rows, 200, { page: p.page, pageSize: p.pageSize, total });
});

export const dynamic = "force-dynamic";
void HttpError;

