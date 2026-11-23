import { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { conflict, notFound } from "@/lib/api";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Retrieve the tenant's subscription status, usage vs. plan limits, invoices, and expiry alerts.
 */
export async function getTenantSubscriptionOverview(organizationId: string) {
  const [org, sub, plans, propCount, cabanaCount, userCount] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    db.subscription.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { plan: true, invoices: { orderBy: { createdAt: "desc" }, take: 20 } },
    }),
    db.plan.findMany({ where: { isActive: true }, orderBy: { priceMonthly: "asc" } }),
    db.property.count({ where: { organizationId, deletedAt: null } }),
    db.cabana.count({ where: { organizationId, archivedAt: null } }),
    db.user.count({ where: { organizationId, deletedAt: null } }),
  ]);

  const now = new Date();
  const daysRemaining = sub
    ? Math.max(0, Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / 864e5))
    : 0;
  const expiryAlert =
    sub && daysRemaining <= 7
      ? `Your ${sub.status === "TRIALING" ? "trial" : "subscription"} period ends in ${daysRemaining} day(s) (${sub.currentPeriodEnd.toISOString().slice(0, 10)}).`
      : null;

  return {
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      currency: org.currency,
      onboardingDone: org.onboardingDone,
    },
    subscription: sub,
    plans,
    usage: {
      properties: { used: propCount, max: sub?.plan.maxProperties ?? 1 },
      cabanas: { used: cabanaCount, max: sub?.plan.maxCabanas ?? 10 },
      users: { used: userCount, max: sub?.plan.maxUsers ?? 5 },
    },
    daysRemaining,
    expiryAlert,
  };
}

/**
 * Upgrade or downgrade a tenant's subscription plan.
 * - On downgrade, verifies that current active usage (properties, cabanas, users) does not exceed the target plan's limits.
 * - Generates a `SubscriptionInvoice` for the new billing period and activates the subscription.
 */
export async function changeTenantPlan(params: {
  organizationId: string;
  planCode: string;
  interval: "MONTHLY" | "YEARLY";
}) {
  const plan = await db.plan.findUnique({ where: { code: params.planCode } });
  if (!plan || !plan.isActive) throw notFound("Subscription plan not found");

  const [propCount, cabanaCount, userCount] = await Promise.all([
    db.property.count({ where: { organizationId: params.organizationId, deletedAt: null } }),
    db.cabana.count({ where: { organizationId: params.organizationId, archivedAt: null } }),
    db.user.count({ where: { organizationId: params.organizationId, deletedAt: null } }),
  ]);

  if (propCount > plan.maxProperties) {
    throw conflict(
      `Cannot switch to ${plan.name}: you have ${propCount} properties (plan limit: ${plan.maxProperties})`,
      "USAGE_EXCEEDS_PLAN",
    );
  }
  if (cabanaCount > plan.maxCabanas) {
    throw conflict(
      `Cannot switch to ${plan.name}: you have ${cabanaCount} active cabanas (plan limit: ${plan.maxCabanas})`,
      "USAGE_EXCEEDS_PLAN",
    );
  }
  if (userCount > plan.maxUsers) {
    throw conflict(
      `Cannot switch to ${plan.name}: you have ${userCount} users (plan limit: ${plan.maxUsers})`,
      "USAGE_EXCEEDS_PLAN",
    );
  }

  const now = new Date();
  const periodDays = params.interval === "YEARLY" ? 365 : 30;
  const periodEnd = new Date(now.getTime() + periodDays * 864e5);
  const price = params.interval === "YEARLY" ? plan.priceYearly : plan.priceMonthly;
  const invNumber = `SINV-${now.toISOString().slice(2, 10).replace(/-/g, "")}-${randomInt(10000, 99999)}`;

  return db.$transaction(
    async (tx) => {
      const existing = await tx.subscription.findFirst({
        where: { organizationId: params.organizationId },
        orderBy: { createdAt: "desc" },
      });

      const sub = existing
        ? await tx.subscription.update({
            where: { id: existing.id },
            data: {
              planId: plan.id,
              status: "ACTIVE",
              interval: params.interval,
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
            },
            include: { plan: true },
          })
        : await tx.subscription.create({
            data: {
              organizationId: params.organizationId,
              planId: plan.id,
              status: "ACTIVE",
              interval: params.interval,
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
            },
            include: { plan: true },
          });

      const invoice = await tx.subscriptionInvoice.create({
        data: {
          subscriptionId: sub.id,
          number: invNumber,
          amount: price,
          paidAt: now,
          dueAt: now,
        },
      });

      await tx.organization.update({
        where: { id: params.organizationId },
        data: { status: "ACTIVE", onboardingDone: true },
      });

      return { subscription: sub, invoice };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/**
 * Super Admin platform-wide overview: organizations, subscriptions, SaaS revenue, plans, and audit logs.
 */
export async function getSuperAdminOverview() {
  const [organizations, plans, invoices, auditLogs] = await Promise.all([
    db.organization.findMany({
      where: { deletedAt: null },
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { plan: { select: { code: true, name: true, priceMonthly: true } } },
        },
        _count: { select: { properties: true, users: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.plan.findMany({ orderBy: { priceMonthly: "asc" } }),
    db.subscriptionInvoice.findMany({
      include: { subscription: { include: { organization: { select: { name: true } }, plan: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
  ]);

  let totalRevenue = D(0);
  for (const inv of invoices) {
    if (inv.paidAt) totalRevenue = totalRevenue.plus(inv.amount);
  }

  const activeSubs = organizations.filter((o) => o.subscriptions[0]?.status === "ACTIVE").length;
  const trialAccounts = organizations.filter((o) => o.status === "TRIAL" || o.subscriptions[0]?.status === "TRIALING").length;
  const expiredSubs = organizations.filter((o) => ["EXPIRED", "CANCELLED"].includes(o.subscriptions[0]?.status ?? "")).length;
  const suspendedOrgs = organizations.filter((o) => o.status === "SUSPENDED").length;

  return {
    metrics: {
      totalOrganizations: organizations.length,
      activeSubscriptions: activeSubs,
      trialAccounts,
      expiredSubscriptions: expiredSubs,
      suspendedOrganizations: suspendedOrgs,
      subscriptionRevenue: totalRevenue.toFixed(2),
      systemHealth: "HEALTHY",
    },
    organizations,
    plans,
    invoices,
    auditLogs,
  };
}

