import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit } from "@/lib/http";
import { getSuperAdminOverview } from "@/modules/saas/service";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requirePlatformAdmin();
  return ok(await getSuperAdminOverview());
});

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("org_status"),
    organizationId: z.string().min(1),
    status: z.enum(["ACTIVE", "SUSPENDED", "TRIAL"]),
    reason: z.string().max(300).optional(),
  }),
  z.object({
    action: z.literal("upsert_plan"),
    code: z.string().trim().min(2).max(30),
    name: z.string().trim().min(2).max(60),
    priceMonthly: z.number().min(0).max(10_000_000),
    priceYearly: z.number().min(0).max(100_000_000),
    maxProperties: z.number().int().min(1).max(1000),
    maxCabanas: z.number().int().min(1).max(10000),
    maxUsers: z.number().int().min(1).max(10000),
  }),
]);

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePlatformAdmin();
  const body = await parseBody(req, postSchema);

  if (body.action === "org_status") {
    const org = await db.organization.findUnique({ where: { id: body.organizationId } });
    if (!org) throw notFound("Organization not found");
    const updated = await db.organization.update({
      where: { id: org.id },
      data: {
        status: body.status,
        suspendedReason: body.status === "SUSPENDED" ? body.reason ?? "Suspended by Super Admin" : null,
      },
    });
    await audit(ctx, "platform.org.status", "Organization", org.id, { status: body.status });
    return ok(updated);
  }

  const plan = await db.plan.upsert({
    where: { code: body.code.toLowerCase() },
    update: {
      name: body.name,
      priceMonthly: body.priceMonthly.toFixed(2),
      priceYearly: body.priceYearly.toFixed(2),
      maxProperties: body.maxProperties,
      maxCabanas: body.maxCabanas,
      maxUsers: body.maxUsers,
    },
    create: {
      code: body.code.toLowerCase(),
      name: body.name,
      priceMonthly: body.priceMonthly.toFixed(2),
      priceYearly: body.priceYearly.toFixed(2),
      maxProperties: body.maxProperties,
      maxCabanas: body.maxCabanas,
      maxUsers: body.maxUsers,
    },
  });
  await audit(ctx, "platform.plan.upsert", "Plan", plan.id, { code: plan.code });
  return ok(plan, 201);
});

