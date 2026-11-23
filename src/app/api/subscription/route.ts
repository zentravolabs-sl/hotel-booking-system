import { z } from "zod";
import { route, ok } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit } from "@/lib/http";
import { getTenantSubscriptionOverview, changeTenantPlan } from "@/modules/saas/service";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await requirePermission("org:manage");
  return ok(await getTenantSubscriptionOverview(ctx.organizationId));
});

const schema = z.object({
  planCode: z.string().min(1),
  interval: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("subscription:manage");
  const body = await parseBody(req, schema);
  const res = await changeTenantPlan({
    organizationId: ctx.organizationId,
    planCode: body.planCode,
    interval: body.interval,
  });
  await audit(ctx, "subscription.changePlan", "Subscription", res.subscription.id, body);
  return ok(res, 201);
});

