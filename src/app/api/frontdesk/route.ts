import { z } from "zod";
import { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { route, ok, notFound, conflict } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("booking:read");
  const { propertyId, date } = z
    .object({ propertyId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
    .parse(searchParams(req));
  const prop = await assertPropertyAccess(ctx, propertyId);

  const dayIso = date ?? new Date().toISOString().slice(0, 10);
  const dayStart = new Date(`${dayIso}T00:00:00.000Z`);
  const dayEnd = new Date(`${dayIso}T23:59:59.999Z`);

  const bookingInclude = {
    guest: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, idType: true, idNumber: true, isVip: true, isBlacklisted: true } },
    items: { include: { cabana: { select: { id: true, code: true, name: true, status: true, cleaningStatus: true } } } },
    charges: true,
  };

  const [arrivals, departures, inHouse, cabanas] = await Promise.all([
    db.booking.findMany({
      where: {
        organizationId: ctx.organizationId,
        propertyId,
        status: { in: ["CONFIRMED", "PENDING"] },
        startAt: { gte: dayStart, lte: dayEnd },
      },
      include: bookingInclude,
      orderBy: { startAt: "asc" },
    }),
    db.booking.findMany({
      where: {
        organizationId: ctx.organizationId,
        propertyId,
        status: "CHECKED_IN",
        endAt: { lte: dayEnd },
      },
      include: bookingInclude,
      orderBy: { endAt: "asc" },
    }),
    db.booking.findMany({
      where: {
        organizationId: ctx.organizationId,
        propertyId,
        status: "CHECKED_IN",
      },
      include: bookingInclude,
      orderBy: { startAt: "asc" },
    }),
    db.cabana.findMany({
      where: { organizationId: ctx.organizationId, propertyId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, zone: true, status: true, cleaningStatus: true, maxAdults: true },
    }),
  ]);

  return ok({
    property: { id: prop.id, name: prop.name, currency: prop.currency, timezone: prop.timezone },
    date: dayIso,
    arrivals,
    departures,
    inHouse,
    cabanas,
  });
});

const collectSchema = z.object({
  bookingId: z.string().min(1),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD"]),
  amount: z.number().min(0.01).max(100_000_000),
  providerRef: z.string().trim().max(120).optional(),
});

/** Quick front-desk offline payment collection (Cash, Card terminal, or Bank Transfer) with receipt generation. */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("payment:collect");
  const body = await parseBody(req, collectSchema);
  const b = await db.booking.findFirst({ where: { id: body.bookingId, organizationId: ctx.organizationId } });
  if (!b) throw notFound("Booking not found");
  await assertPropertyAccess(ctx, b.propertyId);
  if (["CANCELLED", "EXPIRED"].includes(b.status)) throw conflict("Cannot collect payment for a cancelled/expired booking");

  const amt = new Prisma.Decimal(body.amount.toFixed(2));
  const receiptNo = `RCP-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomInt(100000, 999999)}`;

  const result = await db.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        organizationId: ctx.organizationId,
        bookingId: b.id,
        method: body.method,
        status: "SUCCEEDED",
        amount: amt,
        provider: body.method,
        providerRef: body.providerRef || receiptNo,
        receiptNo,
        receivedById: ctx.userId,
        paidAt: new Date(),
      },
    });
    const newPaid = b.paidTotal.plus(amt);
    const paymentStatus = newPaid.gte(b.total) ? "PAID" : "PARTIALLY_PAID";
    const booking = await tx.booking.update({
      where: { id: b.id },
      data: {
        paidTotal: newPaid,
        paymentStatus,
        ...(b.status === "PENDING" ? { status: "CONFIRMED", holdExpiresAt: null } : {}),
      },
    });
    return { payment, booking };
  });

  await audit(ctx, "payment.collect", "Payment", result.payment.id, { bookingId: b.id, amount: amt.toString(), method: body.method });
  return ok(result, 201);
});

