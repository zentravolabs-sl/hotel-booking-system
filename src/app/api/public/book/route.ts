import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { createSession, getSessionUser } from "@/lib/auth/session";
import { parseBody } from "@/lib/http";
import { createBooking, createBookingSchema } from "@/modules/bookings/service";
import { PayHereAdapter } from "@/modules/finance/payhere";

export const dynamic = "force-dynamic";

const publicBookSchema = createBookingSchema.and(
  z.object({
    createAccountPassword: z.string().min(8, "Password must be at least 8 characters").max(128).optional(),
    payMode: z.enum(["DEPOSIT", "FULL", "HOLD_ONLY"]).default("DEPOSIT"),
  }),
);

/**
 * Public customer booking endpoint:
 * - Allows booking WITHOUT account creation (guest checkout).
 * - Optionally creates & signs in a `CUSTOMER` account if `createAccountPassword` + `guest.email` are provided.
 * - Creates a time-limited `PENDING` hold with overlap prevention and returns a PayHere checkout session payload.
 */
export const POST = route(async (req: Request) => {
  rateLimit(`public_book:${clientIp(req)}`, 15, 15 * 60_000);
  const body = await parseBody(req, publicBookSchema);

  const prop = await db.property.findFirst({
    where: { id: body.propertyId, isPublic: true, deletedAt: null },
  });
  if (!prop) throw notFound("Property not found");

  let sessionUser = await getSessionUser();

  if (!sessionUser && body.createAccountPassword && body.guest.email) {
    const email = body.guest.email.toLowerCase();
    const existing = await db.user.findUnique({ where: { email } });
    if (!existing) {
      let custRole = await db.role.findFirst({ where: { organizationId: null, key: "CUSTOMER" } });
      custRole ??= await db.role.create({ data: { key: "CUSTOMER", name: "Customer", isSystem: true } });
      const created = await db.user.create({
        data: {
          email,
          name: `${body.guest.firstName} ${body.guest.lastName}`.trim(),
          phone: body.guest.phone,
          passwordHash: await bcrypt.hash(body.createAccountPassword, 12),
          roleId: custRole.id,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });
      await createSession(created.id, { ip: clientIp(req) });
      sessionUser = await getSessionUser();
    }
  }

  const booking = await createBooking(body, {
    organizationId: prop.organizationId,
    userId: sessionUser?.id ?? null,
    source: "WEBSITE",
  });

  if (sessionUser) {
    await db.guest.update({ where: { id: booking.guestId }, data: { userId: sessionUser.id } });
  }

  const amountToPay =
    body.payMode === "DEPOSIT" && booking.depositRequired.gt(0)
      ? booking.depositRequired
      : booking.total;

  const adapter = new PayHereAdapter();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const payhereSession =
    body.payMode === "HOLD_ONLY"
      ? null
      : adapter.createCheckoutSession({
          orderId: booking.reference,
          amount: amountToPay,
          currency: prop.currency,
          itemTitle: `Cabana Reservation ${booking.reference} at ${prop.name}`,
          firstName: body.guest.firstName,
          lastName: body.guest.lastName,
          email: body.guest.email ?? "guest@cabanapro.local",
          phone: body.guest.phone ?? "0000000000",
          returnUrl: `${appUrl}/my-bookings?ref=${encodeURIComponent(booking.reference)}`,
          cancelUrl: `${appUrl}/my-bookings?ref=${encodeURIComponent(booking.reference)}`,
          notifyUrl: `${appUrl}/api/payments/payhere/webhook`,
        });

  return ok({ booking, payhereSession }, 201);
});

