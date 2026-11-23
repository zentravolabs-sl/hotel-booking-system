import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { route, ok, notFound, conflict } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit } from "@/lib/http";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

const chargeSchema = z.object({
  type: z.enum(["EXTRA_GUEST", "EXTRA_BED", "EARLY_CHECKIN", "LATE_CHECKOUT", "SERVICE", "OTHER"]),
  description: z.string().trim().min(2).max(200),
  quantity: z.number().min(0.01).max(1000).default(1),
  unitPrice: z.number().min(0).max(10_000_000),
});

export const POST = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("booking:modify");
  const { id } = await params;
  const b = await db.booking.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!b) throw notFound("Booking not found");
  await assertPropertyAccess(ctx, b.propertyId);
  if (["CANCELLED", "EXPIRED"].includes(b.status)) throw conflict("Cannot add charges to a cancelled/expired booking");

  const body = await parseBody(req, chargeSchema);
  const qty = new Prisma.Decimal(body.quantity.toFixed(2));
  const unit = new Prisma.Decimal(body.unitPrice.toFixed(2));
  const amount = qty.mul(unit).toDecimalPlaces(2);

  const charge = await db.$transaction(async (tx) => {
    const c = await tx.bookingCharge.create({
      data: { bookingId: id, type: body.type, description: body.description, quantity: qty, unitPrice: unit, amount, createdById: ctx.userId },
    });
    const newTotal = b.total.plus(amount);
    const nextPay = b.paidTotal.gte(newTotal) ? "PAID" : b.paidTotal.gt(0) ? "PARTIALLY_PAID" : "UNPAID";
    await tx.booking.update({ where: { id }, data: { total: newTotal, paymentStatus: nextPay } });
    return c;
  });
  await audit(ctx, "booking.charge.add", "Booking", id, { amount: amount.toString(), type: body.type });
  return ok(charge, 201);
});

