import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  getTenantSubscriptionOverview,
  changeTenantPlan,
  getSuperAdminOverview,
} from "./service";

const tag = `p10_${Date.now()}`;
let orgId = "";

beforeAll(async () => {
  await db.plan.upsert({
    where: { code: `small-${tag}` },
    update: {},
    create: {
      code: `small-${tag}`,
      name: "Small Plan",
      priceMonthly: "2900.00",
      priceYearly: "29000.00",
      maxProperties: 1,
      maxCabanas: 1,
      maxUsers: 2,
    },
  });
  await db.plan.upsert({
    where: { code: `large-${tag}` },
    update: {},
    create: {
      code: `large-${tag}`,
      name: "Large Plan",
      priceMonthly: "9900.00",
      priceYearly: "99000.00",
      maxProperties: 5,
      maxCabanas: 25,
      maxUsers: 20,
    },
  });

  const o = await db.organization.create({ data: { name: tag, slug: tag } });
  orgId = o.id;
  const p = await db.property.create({ data: { organizationId: orgId, name: "P10 Resort", slug: "p10-resort" } });
  await db.cabana.createMany({
    data: [
      { organizationId: orgId, propertyId: p.id, code: "C-01", name: "Cabana 1" },
      { organizationId: orgId, propertyId: p.id, code: "C-02", name: "Cabana 2" },
    ],
  });
});

afterAll(async () => {
  await db.subscriptionInvoice.deleteMany({ where: { subscription: { organizationId: orgId } } });
  await db.subscription.deleteMany({ where: { organizationId: orgId } });
  await db.cabana.deleteMany({ where: { organizationId: orgId } });
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.plan.deleteMany({ where: { code: { in: [`small-${tag}`, `large-${tag}`] } } });
});

describe("Phase 10: SaaS subscriptions, upgrade/downgrade limits & Super Admin metrics", () => {
  it("upgrades plan with invoice generation, prevents downgrading below active usage, and reports Super Admin metrics", async () => {
    // 1) Upgrade to Large Plan (allows 25 cabanas; org has 2 cabanas)
    const up = await changeTenantPlan({
      organizationId: orgId,
      planCode: `large-${tag}`,
      interval: "MONTHLY",
    });
    expect(up.subscription.status).toBe("ACTIVE");
    expect(up.invoice.amount.toFixed(2)).toBe("9900.00");

    // 2) Attempt to downgrade to Small Plan (maxCabanas = 1, but org has 2 active cabanas) -> rejected with USAGE_EXCEEDS_PLAN
    await expect(
      changeTenantPlan({
        organizationId: orgId,
        planCode: `small-${tag}`,
        interval: "MONTHLY",
      }),
    ).rejects.toMatchObject({ code: "USAGE_EXCEEDS_PLAN" });

    // 3) Verify tenant overview usage tracking
    const overview = await getTenantSubscriptionOverview(orgId);
    expect(overview.usage.cabanas).toEqual({ used: 2, max: 25 });
    expect(overview.usage.properties).toEqual({ used: 1, max: 5 });

    // 4) Verify Super Admin platform overview includes the paid subscription invoice
    const sa = await getSuperAdminOverview();
    expect(sa.metrics.totalOrganizations).toBeGreaterThanOrEqual(1);
    expect(Number(sa.metrics.subscriptionRevenue)).toBeGreaterThanOrEqual(9900);
  }, 60_000);
});

