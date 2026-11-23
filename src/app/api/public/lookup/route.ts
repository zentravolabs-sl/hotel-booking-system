import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { getSessionUser } from "@/lib/auth/session";
import { searchParams } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const q = z
    .object({
      ref: z.string().trim().max(40).optional(),
      email: z.string().trim().max(120).optional(),
    })
    .parse(searchParams(req));

  const user = await getSessionUser();

  if (q.ref) {
    const b = await db.booking.findUnique({
      where: { reference: q.ref.toUpperCase() },
      include: {
        property: { select: { id: true, name: true, city: true, phone: true, email: true, currency: true, timezone: true } },
        guest: { select: { firstName: true, lastName: true, email: true, phone: true } },
        items: { include: { cabana: { select: { code: true, name: true, zone: true } } } },
        charges: true,
      },
    });
    if (!b) throw notFound("Booking reference not found");
    // Require matching email/phone unless user is logged in as the booking guest
    if (
      q.email &&
      b.guest.email?.toLowerCase() !== q.email.toLowerCase() &&
      b.guest.phone !== q.email
    ) {
      throw notFound("Booking not found for that email or phone");
    }
    return ok({ bookings: [b] });
  }

  if (user) {
    const bookings = await db.booking.findMany({
      where: {
        OR: [{ createdById: user.id }, { guest: { email: user.email } }, { guest: { userId: user.id } }],
      },
      include: {
        property: { select: { id: true, name: true, city: true, phone: true, email: true, currency: true, timezone: true } },
        guest: { select: { firstName: true, lastName: true, email: true, phone: true } },
        items: { include: { cabana: { select: { code: true, name: true, zone: true } } } },
        charges: true,
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    return ok({ bookings });
  }

  return ok({ bookings: [] });
});

