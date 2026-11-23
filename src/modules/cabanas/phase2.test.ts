import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { assertWithinPlan } from "@/lib/http";
import { loadCabana } from "./access";
import type { AuthContext } from "@/lib/auth/context";
import { ALL_PERMISSIONS } from "@/lib/permissions";

const tag = `p2_${Date.now()}`;
let orgA = "", orgB = "", propA = "", propB = "", cabA = "";

beforeAll(async () => {
  const plan = await db.plan.upsert({
    where: { code: `test-plan-${tag}` },
    update: {},
    create: { code: `test-plan-${tag}`, name: "Test Starter", priceMonthly: "1000", priceYearly: "10000", maxProperties: 1, maxCabanas: 2, maxUsers: 2 },
  });
  const oA = await db.organization.create({ data: { name: tag + "A", slug: tag + "a" } });
  const oB = await db.organization.create({ data: { name: tag + "B", slug: tag + "b" } });
  orgA = oA.id;
  orgB = oB.id;
  await db.subscription.create({
    data: { organizationId: orgA, planId: plan.id, status: "TRIALING", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 864e5) },
  });
  const pA = await db.property.create({ data: { organizationId: orgA, name: "Prop A", slug: "prop-a", settings: { create: {} } } });
  const pB = await db.property.create({ data: { organizationId: orgB, name: "Prop B", slug: "prop-b", settings: { create: {} } } });
  propA = pA.id;
  propB = pB.id;
  const cA = await db.cabana.create({ data: { organizationId: orgA, propertyId: propA, code: "C-A1", name: "Cabana A1" } });
  cabA = cA.id;
});

afterAll(async () => {
  await db.cabana.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.plan.deleteMany({ where: { code: `test-plan-${tag}` } });
});

const makeCtx = (organizationId: string, propertyIds: string[], roleKey = "OWNER"): AuthContext => ({
  userId: "u-test",
  organizationId,
  roleKey,
  permissions: new Set(ALL_PERMISSIONS),
  propertyIds,
  isSuperAdmin: false,
});

describe("Phase 2: Cabana access & plan limits", () => {
  it("allows owner of orgA to load their cabana", async () => {
    const c = await loadCabana(makeCtx(orgA, [propA]), cabA);
    expect(c.code).toBe("C-A1");
  });

  it("blocks orgB from loading orgA's cabana with 404 (no tenant leakage)", async () => {
    await expect(loadCabana(makeCtx(orgB, [propB]), cabA)).rejects.toMatchObject({ status: 404 });
  });

  it("blocks property-scoped staff without assignment to propA", async () => {
    await expect(loadCabana(makeCtx(orgA, [], "RECEPTIONIST"), cabA)).rejects.toMatchObject({ status: 404 });
  });

  it("enforces plan limits on properties and cabanas", async () => {
    // maxProperties is 1 and propA already exists -> must reject with PLAN_LIMIT (409)
    await expect(assertWithinPlan(orgA, "properties")).rejects.toMatchObject({ status: 409, code: "PLAN_LIMIT" });
    // maxCabanas is 2 and only 1 exists -> must allow
    await expect(assertWithinPlan(orgA, "cabanas")).resolves.toBeUndefined();
  });
});

