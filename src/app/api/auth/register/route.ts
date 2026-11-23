import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { route, ok, conflict, forbidden } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { randomToken, sha256 } from "@/lib/auth/session";

const schema = z.object({
  organizationName: z.string().trim().min(2).max(100),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, "Use at least 10 characters").max(128)
    .regex(/[a-z]/, "Add a lowercase letter").regex(/[A-Z]/, "Add an uppercase letter").regex(/\d/, "Add a number"),
  propertyName: z.string().trim().min(2).max(100),
  timezone: z.string().default("Asia/Colombo"),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";

export const POST = route(async (req: Request) => {
  rateLimit(`register:${clientIp(req)}`, 5, 60 * 60_000);
  const body = schema.parse(await req.json());
  if (await db.user.findUnique({ where: { email: body.email } })) throw conflict("An account with this email already exists");

  const role = await db.role.findFirst({ where: { organizationId: null, key: "OWNER" } });
  const plan = await db.plan.findUnique({ where: { code: "starter" } });
  if (!role || !plan) throw forbidden("Platform is not initialised (run the seed)");

  const trialEnds = new Date(Date.now() + 14 * 864e5);
  const verifyToken = randomToken();
  const result = await db.$transaction(async (tx) => {
    const base = slugify(body.organizationName);
    const slug = (await tx.organization.findUnique({ where: { slug: base } })) ? `${base}-${randomToken().slice(0, 5).toLowerCase()}` : base;
    const org = await tx.organization.create({
      data: { name: body.organizationName, slug, email: body.email, trialEndsAt: trialEnds },
    });
    const property = await tx.property.create({
      data: { organizationId: org.id, name: body.propertyName, slug: slugify(body.propertyName), timezone: body.timezone, settings: { create: {} } },
    });
    const user = await tx.user.create({
      data: {
        organizationId: org.id, email: body.email, name: body.name, roleId: role.id,
        passwordHash: await bcrypt.hash(body.password, 12),
        status: "ACTIVE", // flip to PENDING + enforce verification once an email provider is configured
        properties: { create: { propertyId: property.id } },
      },
    });
    await tx.subscription.create({
      data: { organizationId: org.id, planId: plan.id, status: "TRIALING", currentPeriodStart: new Date(), currentPeriodEnd: trialEnds },
    });
    await tx.authToken.create({
      data: { userId: user.id, type: "EMAIL_VERIFY", tokenHash: sha256(verifyToken), expiresAt: new Date(Date.now() + 864e5) },
    });
    await tx.auditLog.create({ data: { organizationId: org.id, userId: user.id, action: "org.register", entity: "Organization", entityId: org.id } });
    return { org, user, property };
  });
  if (process.env.NODE_ENV !== "production") console.log(`[dev] verify link: /verify-email?token=${verifyToken}`);
  return ok({ organizationId: result.org.id, propertyId: result.property.id }, 201);
});

