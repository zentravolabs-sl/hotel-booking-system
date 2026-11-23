import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit } from "@/lib/http";
import { checkInBooking } from "@/modules/frontdesk/service";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

const schema = z.object({
  idType: z.enum(["NIC", "PASSPORT", "DRIVING_LICENSE"]).optional(),
  idNumber: z.string().trim().max(60).optional(),
  nationality: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(30).optional(),
  earlyCheckInFee: z.number().min(0).max(1_000_000).optional(),
});

export const POST = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("booking:frontdesk");
  const { id } = await params;
  const b = await db.booking.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!b) throw notFound("Booking not found");
  await assertPropertyAccess(ctx, b.propertyId);
  const body = await parseBody(req, schema);
  const updated = await checkInBooking(ctx.organizationId, id, ctx.userId, body);
  await audit(ctx, "booking.checkin", "Booking", id);
  return ok(updated);
});

