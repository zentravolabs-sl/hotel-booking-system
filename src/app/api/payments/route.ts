import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit } from "@/lib/http";
import { recordBookingPayment } from "@/modules/finance/service";
import { PayHereAdapter } from "@/modules/finance/payhere";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("payment:read");
  const { propertyId, method, limit } = z
    .object({
      propertyId: z.string().optional(),
      method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "ONLINE"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    })
    .parse(searchParams(req));
  if (propertyId) await assertPropertyAccess(ctx, propertyId);

  const payments = await db.payment.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(method ? { method } : {}),
    },
    include: { refunds: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const bookingIds = payments.map((p) => p.bookingId).filter((x): x is string => Boolean(x));
  const bookings = await db.booking.findMany({
    where: { id: { in: bookingIds }, ...(propertyId ? { propertyId } : {}) },
    select: { id: true, reference: true, propertyId: true, guest: { select: { firstName: true, lastName: true } } },
  });
  const bMap = new Map(bookings.map((b) => [b.id, b]));

  const filtered = propertyId ? payments.filter((p) => p.bookingId && bMap.has(p.bookingId)) : payments;
  return ok(filtered.map((p) => ({ ...p, booking: p.bookingId ? bMap.get(p.bookingId) ?? null : null })));
});

const createSchema = z.object({
  bookingId: z.string().min(1),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "ONLINE"]),
  amount: z.number().min(0.01).max(100_000_000),
  providerRef: z.string().trim().max(120).optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
  prepareOnlineCheckout: z.boolean().default(false),
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("payment:collect");
  const body = await parseBody(req, createSchema);
  const b = await db.booking.findFirst({
    where: { id: body.bookingId, organizationId: ctx.organizationId },
    include: { property: true, guest: true },
  });
  if (!b) throw notFound("Booking not found");
  await assertPropertyAccess(ctx, b.propertyId);

  if (body.prepareOnlineCheckout) {
    const adapter = new PayHereAdapter();
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const session = adapter.createCheckoutSession({
      orderId: b.reference,
      amount: body.amount.toFixed(2),
      currency: b.property.currency,
      itemTitle: `Reservation ${b.reference} at ${b.property.name}`,
      firstName: b.guest.firstName,
      lastName: b.guest.lastName,
      email: b.guest.email ?? "guest@cabanapro.local",
      phone: b.guest.phone ?? "0000000000",
      returnUrl: `${appUrl}/dashboard/bookings`,
      cancelUrl: `${appUrl}/dashboard/bookings`,
      notifyUrl: `${appUrl}/api/payments/payhere/webhook`,
    });
    return ok({ checkoutSession: session });
  }

  const res = await recordBookingPayment({
    organizationId: ctx.organizationId,
    bookingId: b.id,
    method: body.method,
    amount: body.amount,
    currency: b.property.currency,
    providerRef: body.providerRef,
    idempotencyKey: body.idempotencyKey,
    receivedById: ctx.userId,
  });
  await audit(ctx, "payment.record", "Payment", res.payment.id, { amount: body.amount, method: body.method });
  return ok(res, res.duplicate ? 200 : 201);
});

