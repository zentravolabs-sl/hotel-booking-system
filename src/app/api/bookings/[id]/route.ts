import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit } from "@/lib/http";
import { cancelBooking, modifyBooking, modifyBookingSchema } from "@/modules/bookings/operations";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: P) => {
  const ctx = await requirePermission("booking:read");
  const { id } = await params;
  const b = await db.booking.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      property: { select: { id: true, name: true, currency: true, timezone: true } },
      guest: true,
      items: { include: { cabana: { select: { id: true, code: true, name: true, status: true } } } },
      history: { orderBy: { createdAt: "desc" } },
      charges: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!b) throw notFound("Booking not found");
  await assertPropertyAccess(ctx, b.propertyId);
  return ok(b);
});

export const PATCH = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("booking:modify");
  const { id } = await params;
  const existing = await db.booking.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!existing) throw notFound("Booking not found");
  await assertPropertyAccess(ctx, existing.propertyId);
  const body = await parseBody(req, modifyBookingSchema);
  const updated = await modifyBooking(ctx.organizationId, id, body, ctx.userId);
  await audit(ctx, "booking.modify", "Booking", id);
  return ok(updated);
});

const cancelSchema = z.object({ reason: z.string().trim().min(2, "Provide a cancellation reason").max(300) });

export const DELETE = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("booking:modify");
  const { id } = await params;
  const existing = await db.booking.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!existing) throw notFound("Booking not found");
  await assertPropertyAccess(ctx, existing.propertyId);
  const { reason } = await parseBody(req, cancelSchema);
  const cancelled = await cancelBooking(ctx.organizationId, id, reason, ctx.userId);
  await audit(ctx, "booking.cancel", "Booking", id, { reason });
  return ok(cancelled);
});

