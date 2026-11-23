import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_DEFAULTS } from "../src/lib/permissions";

const db = new PrismaClient();

async function main() {
  for (const key of ALL_PERMISSIONS) {
    await db.permission.upsert({
      where: { key }, update: { label: PERMISSIONS[key] },
      create: { key, label: PERMISSIONS[key], group: key.split(":")[0] },
    });
  }
  const perms = await db.permission.findMany();
  const byKey = new Map(perms.map((p) => [p.key, p.id]));

  for (const [key, def] of Object.entries(ROLE_DEFAULTS)) {
    let role = await db.role.findFirst({ where: { organizationId: null, key: key as never } });
    role ??= await db.role.create({ data: { key: key as never, name: def.name, isSystem: true } });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({
      data: def.permissions.map((k) => ({ roleId: role.id, permissionId: byKey.get(k)! })),
    });
  }

  const plans = [
    { code: "starter", name: "Starter", priceMonthly: "4900", priceYearly: "49000", maxProperties: 1, maxCabanas: 10, maxUsers: 5 },
    { code: "growth", name: "Growth", priceMonthly: "14900", priceYearly: "149000", maxProperties: 3, maxCabanas: 40, maxUsers: 25 },
    { code: "enterprise", name: "Enterprise", priceMonthly: "39900", priceYearly: "399000", maxProperties: 50, maxCabanas: 1000, maxUsers: 500 },
  ];
  for (const p of plans) await db.plan.upsert({ where: { code: p.code }, update: {}, create: p });

  const sa = process.env.SEED_SUPERADMIN_EMAIL, pw = process.env.SEED_SUPERADMIN_PASSWORD;
  if (sa && pw) {
    const role = await db.role.findFirstOrThrow({ where: { organizationId: null, key: "SUPER_ADMIN" } });
    await db.user.upsert({
      where: { email: sa.toLowerCase() }, update: {},
      create: { email: sa.toLowerCase(), name: "Super Admin", passwordHash: await bcrypt.hash(pw, 12), roleId: role.id, status: "ACTIVE", emailVerifiedAt: new Date() },
    });
    console.log("Super admin ready:", sa);
  }
  console.log("Seed complete");
}
main().finally(() => db.$disconnect());

