import { db } from "../db";
import { forbidden, unauthorized, notFound } from "../api";
import { getSessionUser } from "./session";
import { ORG_WIDE_ROLES, type Permission } from "../permissions";

export interface AuthContext {
  userId: string;
  /** Tenant id comes from the DB user row — never from the request. Null only for SUPER_ADMIN. */
  organizationId: string | null;
  roleKey: string;
  permissions: Set<string>;
  propertyIds: string[];
  isSuperAdmin: boolean;
}

export async function requireAuth(): Promise<AuthContext> {
  const u = await getSessionUser();
  if (!u) throw unauthorized();
  return {
    userId: u.id,
    organizationId: u.organizationId,
    roleKey: u.role.key,
    permissions: new Set(u.role.permissions.map((rp) => rp.permission.key)),
    propertyIds: u.properties.map((p) => p.propertyId),
    isSuperAdmin: u.role.key === "SUPER_ADMIN",
  };
}

export async function requirePermission(perm: Permission): Promise<AuthContext & { organizationId: string }> {
  const ctx = await requireAuth();
  if (!ctx.permissions.has(perm)) throw forbidden();
  if (!ctx.organizationId) throw forbidden("Tenant context required");
  return ctx as AuthContext & { organizationId: string };
}

export async function requirePlatformAdmin() {
  const ctx = await requireAuth();
  if (!ctx.isSuperAdmin || !ctx.permissions.has("platform:manage")) throw forbidden();
  return ctx;
}

/**
 * Verifies a property belongs to the caller's organization AND the caller may access it.
 * Returns 404 (not 403) for foreign tenants so existence is not leaked.
 */
export async function assertPropertyAccess(ctx: AuthContext, propertyId: string) {
  const prop = await db.property.findFirst({
    where: { id: propertyId, organizationId: ctx.organizationId ?? "__none__", deletedAt: null },
    include: { settings: true },
  });
  if (!prop) throw notFound("Property not found");
  if (!ORG_WIDE_ROLES.has(ctx.roleKey) && !ctx.propertyIds.includes(propertyId)) throw notFound("Property not found");
  return prop;
}

