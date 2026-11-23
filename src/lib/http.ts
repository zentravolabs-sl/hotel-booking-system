import type { ZodType } from "zod";
import { db } from "./db";
import { conflict, HttpError } from "./api";
import type { AuthContext } from "./auth/context";
import { ORG_WIDE_ROLES } from "./permissions";

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON", "BAD_JSON");
  }
  return schema.parse(raw);
}

export const searchParams = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);

export async function audit(ctx: AuthContext, action: string, entity: string, entityId?: string, meta?: object) {
  await db.auditLog.create({
    data: { organizationId: ctx.organizationId, userId: ctx.userId, action, entity, entityId, meta: meta as never },
  });
}

/** Property ids the caller may access (undefined = all org properties). */
export const accessibleProperties = (ctx: AuthContext) => (ORG_WIDE_ROLES.has(ctx.roleKey) ? undefined : ctx.propertyIds);

/** Plan-limit enforcement. Latest subscription defines the plan. */
export async function assertWithinPlan(organizationId: string, resource: "properties" | "cabanas" | "users") {
  const sub = await db.subscription.findFirst({
    where: { organizationId }, orderBy: { createdAt: "desc" }, include: { plan: true },
  });
  if (!sub || ["EXPIRED", "CANCELLED"].includes(sub.status)) throw new HttpError(402, "Your subscription is not active", "SUBSCRIPTION_INACTIVE");
  const [limit, used] =
    resource === "properties"
      ? [sub.plan.maxProperties, await db.property.count({ where: { organizationId, deletedAt: null } })]
      : resource === "cabanas"
        ? [sub.plan.maxCabanas, await db.cabana.count({ where: { organizationId, archivedAt: null } })]
        : [sub.plan.maxUsers, await db.user.count({ where: { organizationId, deletedAt: null } })];
  if (used >= limit) throw conflict(`Your ${sub.plan.name} plan allows up to ${limit} ${resource}. Upgrade to add more.`, "PLAN_LIMIT");
}

export const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

