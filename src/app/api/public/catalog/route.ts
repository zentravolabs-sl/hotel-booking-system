import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { searchParams } from "@/lib/http";
import { findAvailableCabanas, expireStaleHolds } from "@/modules/bookings/service";
import { computeBookingQuote } from "@/modules/bookings/operations";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  propertyId: z.string().optional(),
  type: z.enum(["HOURLY", "DAY_USE", "OVERNIGHT", "MULTI_NIGHT"]).optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  adults: z.coerce.number().int().min(1).max(30).default(2),
  children: z.coerce.number().int().min(0).max(30).default(0),
  promoCode: z.string().trim().max(40).optional(),
});

export const GET = route(async (req: Request) => {
  const q = querySchema.parse(searchParams(req));
  await expireStaleHolds();

  const properties = await db.property.findMany({
    where: { isPublic: true, deletedAt: null, organization: { status: { in: ["TRIAL", "ACTIVE"] }, deletedAt: null } },
    include: { settings: true },
    orderBy: { createdAt: "asc" },
  });

  const activeProp = (q.propertyId ? properties.find((p) => p.id === q.propertyId) : properties[0]) ?? null;
  if (!activeProp) {
    return ok({ properties: [], activeProperty: null, cabanas: [], packages: [], promos: [], reviews: [] });
  }

  let availableIds: Set<string> | null = null;
  if (q.startAt && q.endAt && q.endAt > q.startAt) {
    const free = await findAvailableCabanas(activeProp.id, activeProp.organizationId, q.startAt, q.endAt);
    availableIds = new Set(free.map((c) => c.id));
  }

  const [cabanas, ratePlans, packages, promos, reviews] = await Promise.all([
    db.cabana.findMany({
      where: {
        propertyId: activeProp.id,
        organizationId: activeProp.organizationId,
        archivedAt: null,
        status: { notIn: ["MAINTENANCE", "INACTIVE"] },
      },
      include: {
        type: { select: { name: true } },
        images: { orderBy: { sortOrder: "asc" } },
        amenities: { include: { amenity: true } },
      },
      orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { code: "asc" }],
    }),
    db.ratePlan.findMany({
      where: { propertyId: activeProp.id, organizationId: activeProp.organizationId, isActive: true },
      orderBy: { weekdayRate: "asc" },
    }),
    db.package.findMany({
      where: { propertyId: activeProp.id, organizationId: activeProp.organizationId, isActive: true },
      orderBy: { price: "asc" },
    }),
    db.promoCode.findMany({
      where: { organizationId: activeProp.organizationId, isActive: true },
      select: { code: true, type: true, value: true, minAmount: true },
      take: 10,
    }),
    db.review.findMany({
      where: { propertyId: activeProp.id, isPublished: true },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  const enriched = await Promise.all(
    cabanas.map(async (c) => {
      const isAvailable = availableIds ? availableIds.has(c.id) : true;
      const hourlyPlan = ratePlans.find((r) => r.kind === "HOURLY" && (r.cabanaId === c.id || r.cabanaId === null));
      const overnightPlan = ratePlans.find((r) => r.kind === "OVERNIGHT" && (r.cabanaId === c.id || r.cabanaId === null));
      let quote = null as Awaited<ReturnType<typeof computeBookingQuote>> | null;
      if (isAvailable && q.startAt && q.endAt && q.endAt > q.startAt && q.type) {
        try {
          quote = await computeBookingQuote(activeProp.organizationId, {
            propertyId: activeProp.id,
            cabanaIds: [c.id],
            type: q.type,
            startAt: q.startAt,
            endAt: q.endAt,
            adults: q.adults,
            children: q.children,
            extraBeds: 0,
            earlyCheckInHours: 0,
            lateCheckOutHours: 0,
            promoCode: q.promoCode || undefined,
          });
        } catch {
          quote = null;
        }
      }
      return {
        ...c,
        isAvailable,
        startingHourlyRate: hourlyPlan?.weekdayRate?.toString() ?? null,
        startingOvernightRate: overnightPlan?.weekdayRate?.toString() ?? null,
        quote,
      };
    }),
  );

  return ok({
    properties: properties.map((p) => ({
      id: p.id,
      name: p.name,
      city: p.city,
      address: p.address,
      phone: p.phone,
      email: p.email,
      currency: p.currency,
      timezone: p.timezone,
      description: p.description,
    })),
    activeProperty: activeProp,
    cabanas: enriched,
    packages,
    promos,
    reviews,
  });
});

