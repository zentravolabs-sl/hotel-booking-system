import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, badRequest } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { searchParams } from "@/lib/http";
import { findAvailableCabanas, expireStaleHolds } from "@/modules/bookings/service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  propertyId: z.string().min(1),
  from: z.coerce.date(),
  to: z.coerce.date(),
  mode: z.enum(["timeline", "free"]).default("timeline"),
});

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("booking:read");
  const q = querySchema.parse(searchParams(req));
  if (q.to <= q.from) throw badRequest("'to' must be after 'from'");
  const prop = await assertPropertyAccess(ctx, q.propertyId);
  await expireStaleHolds();

  if (q.mode === "free") {
    return ok(await findAvailableCabanas(q.propertyId, ctx.organizationId, q.from, q.to));
  }

  const [cabanas, items] = await Promise.all([
    db.cabana.findMany({
      where: { propertyId: q.propertyId, organizationId: ctx.organizationId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: {
        id: true, code: true, name: true, zone: true, status: true, cleaningStatus: true,
        maxAdults: true, maxChildren: true, hourlyEnabled: true, overnightEnabled: true,
        type: { select: { name: true } },
      },
    }),
    db.bookingItem.findMany({
      where: {
        organizationId: ctx.organizationId,
        cabana: { propertyId: q.propertyId },
        startAt: { lt: q.to },
        endAt: { gt: q.from },
        booking: { status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] } },
      },
      include: {
        booking: {
          select: {
            id: true, reference: true, type: true, source: true, status: true, paymentStatus: true,
            startAt: true, endAt: true, total: true, paidTotal: true, adults: true, children: true,
            holdExpiresAt: true,
            guest: { select: { firstName: true, lastName: true, phone: true, isVip: true } },
          },
        },
      },
      orderBy: { startAt: "asc" },
    }),
  ]);

  return ok({
    property: { id: prop.id, name: prop.name, timezone: prop.timezone, currency: prop.currency, turnaroundMinutes: prop.settings?.turnaroundMinutes ?? 30 },
    cabanas,
    items,
  });
});

