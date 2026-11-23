import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createBooking, createBookingSchema } from "@/modules/bookings/service";
import { generateAnalyticsAndReports } from "./service";
import { dispatchNotification, interpolateTemplate } from "@/modules/notifications/service";

const tag = `p9_${Date.now()}`;
let orgId = "", propertyId = "", cabanaId = "";

beforeAll(async () => {
  const o = await db.organization.create({ data: { name: tag, slug: tag } });
  orgId = o.id;
  const p = await db.property.create({
    data: { organizationId: orgId, name: "P9 Resort", slug: "p9-resort", settings: { create: {} } },
  });
  propertyId = p.id;
  const c = await db.cabana.create({ data: { organizationId: orgId, propertyId, code: "C-P9", name: "Lagoon Suite" } });
  cabanaId = c.id;
  await db.ratePlan.create({
    data: { organizationId: orgId, propertyId, name: "Hourly", kind: "HOURLY", weekdayRate: "1500", weekendRate: "1500" },
  });
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { organizationId: orgId } });
  await db.notificationTemplate.deleteMany({ where: { organizationId: orgId } });
  await db.bookingItem.deleteMany({ where: { organizationId: orgId } });
  await db.booking.deleteMany({ where: { organizationId: orgId } });
  await db.guest.deleteMany({ where: { organizationId: orgId } });
  await db.ratePlan.deleteMany({ where: { organizationId: orgId } });
  await db.cabana.deleteMany({ where: { organizationId: orgId } });
  await db.organization.deleteMany({ where: { id: orgId } });
});

describe("Phase 9: Reports, analytics aggregation & multi-channel notifications", () => {
  it("interpolates template placeholders accurately", () => {
    expect(
      interpolateTemplate("Hello {{guestName}}, ref {{reference}} confirmed!", {
        guestName: "Amaya",
        reference: "CP-100",
      }),
    ).toBe("Hello Amaya, ref CP-100 confirmed!");
  });

  it("aggregates analytics KPIs/charts and dispatches multi-channel notifications with delivery history", async () => {
    const startAt = new Date(Date.UTC(2031, 7, 12, 6, 0));
    const endAt = new Date(Date.UTC(2031, 7, 12, 8, 0)); // 2h * 1500 = 3000.00
    const b = await createBooking(
      createBookingSchema.parse({
        propertyId,
        cabanaIds: [cabanaId],
        type: "HOURLY",
        startAt,
        endAt,
        adults: 2,
        guest: { firstName: "Amaya", lastName: "Fernando", email: `amaya-${tag}@example.com` },
      }),
      { organizationId: orgId, userId: null, source: "WALK_IN" },
    );

    const report = await generateAnalyticsAndReports({
      organizationId: orgId,
      propertyId,
      from: new Date(Date.UTC(2031, 7, 1)),
      to: new Date(Date.UTC(2031, 7, 30)),
    });
    expect(report.kpis.periodBookings).toBe(1);
    expect(report.kpis.periodRevenue).toBe("3000.00");
    expect(report.charts.cabanaPerformance[0].revenue).toBe(3000);
    expect(report.charts.bookingSources[0]).toMatchObject({ source: "WALK_IN", count: 1, revenue: 3000 });

    const sent = await dispatchNotification({
      organizationId: orgId,
      event: "BOOKING_CONFIRMATION",
      channels: ["IN_APP", "EMAIL", "WHATSAPP"],
      variables: { reference: b.reference, guestName: "Amaya Fernando", propertyName: "P9 Resort" },
    });
    expect(sent).toHaveLength(3);
    expect(sent.map((n) => n.channel)).toEqual(["IN_APP", "EMAIL", "WHATSAPP"]);
    expect(sent[0].body).toContain(b.reference);
  }, 60_000);
});

