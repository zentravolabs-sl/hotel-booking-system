import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { route, ok, conflict, notFound } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit, assertWithinPlan, isUniqueViolation } from "@/lib/http";
import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await requirePermission("user:read");
  const [users, roles, properties] = await Promise.all([
    db.user.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        lastLoginAt: true,
        role: { select: { id: true, key: true, name: true } },
        properties: { select: { property: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.role.findMany({
      where: {
        OR: [
          { organizationId: null, key: { notIn: ["SUPER_ADMIN", "CUSTOMER"] } },
          { organizationId: ctx.organizationId },
        ],
      },
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: "asc" },
    }),
    db.property.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true },
    }),
  ]);

  return ok({
    users,
    roles,
    properties,
    permissionCatalog: ALL_PERMISSIONS.filter((k) => k !== "platform:manage").map((key) => ({
      key,
      label: PERMISSIONS[key],
    })),
  });
});

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite_user"),
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(128),
    roleId: z.string().min(1),
    propertyIds: z.array(z.string()).default([]),
  }),
  z.object({
    action: z.literal("set_status"),
    userId: z.string().min(1),
    status: z.enum(["ACTIVE", "SUSPENDED"]),
  }),
  z.object({
    action: z.literal("custom_role"),
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(200).optional(),
    permissions: z.array(z.string()).min(1),
  }),
]);

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await parseBody(req, postSchema);

  if (body.action === "custom_role") {
    const ctx = await requirePermission("role:manage");
    const validPerms = body.permissions.filter(
      (k): k is Permission => k !== "platform:manage" && k in PERMISSIONS,
    );
    const dbPerms = await db.permission.findMany({ where: { key: { in: validPerms } } });
    try {
      const role = await db.role.create({
        data: {
          organizationId: ctx.organizationId,
          key: "CUSTOM",
          name: body.name,
          description: body.description,
          isSystem: false,
          permissions: {
            create: dbPerms.map((p) => ({ permissionId: p.id })),
          },
        },
      });
      await audit(ctx, "role.create", "Role", role.id, { name: body.name });
      return ok(role, 201);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict(`A role named "${body.name}" already exists`);
      throw e;
    }
  }

  const ctx = await requirePermission("user:manage");

  if (body.action === "set_status") {
    if (body.userId === ctx.userId) throw conflict("You cannot suspend your own account");
    const u = await db.user.findFirst({ where: { id: body.userId, organizationId: ctx.organizationId } });
    if (!u) throw notFound("User not found");
    const updated = await db.user.update({ where: { id: u.id }, data: { status: body.status } });
    if (body.status === "SUSPENDED") {
      await db.session.deleteMany({ where: { userId: u.id } });
    }
    await audit(ctx, "user.status", "User", u.id, { status: body.status });
    return ok({ id: updated.id, status: updated.status });
  }

  await assertWithinPlan(ctx.organizationId, "users");
  if (await db.user.findUnique({ where: { email: body.email } })) {
    throw conflict("A user with this email already exists");
  }

  const role = await db.role.findFirst({
    where: {
      id: body.roleId,
      OR: [{ organizationId: null, key: { not: "SUPER_ADMIN" } }, { organizationId: ctx.organizationId }],
    },
  });
  if (!role) throw notFound("Role not found");

  const validProps = await db.property.findMany({
    where: { id: { in: body.propertyIds }, organizationId: ctx.organizationId, deletedAt: null },
  });

  const user = await db.user.create({
    data: {
      organizationId: ctx.organizationId,
      name: body.name,
      email: body.email,
      passwordHash: await bcrypt.hash(body.password, 12),
      roleId: role.id,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      properties: { create: validProps.map((p) => ({ propertyId: p.id })) },
    },
  });
  await audit(ctx, "user.invite", "User", user.id, { email: body.email, role: role.name });
  return ok({ id: user.id, email: user.email }, 201);
});

