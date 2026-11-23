import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit } from "@/lib/http";
import { checkOutBooking } from "@/modules/frontdesk/service";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

const schema = z.object({
  lateCheckOutFee: z.number().min(0).max(1_000_000).optional(),
  allowUnpaidCheckout: z.boolean().default(false),
});

export const POST = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("booking:frontdesk");
  const { id } = await params;
  const b = await db.booking.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!b) throw notFound("Booking not found");
  await assertPropertyAccess(ctx, b.propertyId);
  const body = await parseBody(req, schema);
  const updated = await checkOutBooking(ctx.organizationId, id, ctx.userId, body);
  await audit(ctx, "booking.checkout", "Booking", id);
  return ok(updated);
});

