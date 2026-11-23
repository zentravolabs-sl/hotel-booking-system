import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { route, ok, HttpError } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { createSession } from "@/lib/auth/session";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) });
// Constant-time-ish: always run a bcrypt compare, even for unknown emails.
const DUMMY = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5G7Gx8J3x5d1q0b9S5q1Jp9Zk0eY6aG";

export const POST = route(async (req: Request) => {
  const ip = clientIp(req);
  const body = schema.parse(await req.json());
  rateLimit(`login:ip:${ip}`, 20, 15 * 60_000);
  rateLimit(`login:email:${body.email}`, 8, 15 * 60_000);

  const user = await db.user.findUnique({ where: { email: body.email }, include: { organization: true } });
  const valid = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY);
  const fail = () => new HttpError(401, "Invalid email or password", "INVALID_CREDENTIALS");

  if (!user || user.deletedAt) throw fail();
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new HttpError(423, "Account temporarily locked. Try again later.", "LOCKED");
  if (!valid) {
    const failed = user.failedLogins + 1;
    await db.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= 8 ? new Date(Date.now() + 15 * 60_000) : null } });
    throw fail();
  }
  if (user.status === "SUSPENDED") throw new HttpError(403, "This account is suspended", "SUSPENDED");
  if (user.organization?.status === "SUSPENDED") throw new HttpError(403, "This organization is suspended", "ORG_SUSPENDED");
  if (user.status !== "ACTIVE") throw new HttpError(403, "Please verify your email first", "UNVERIFIED");

  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  await db.auditLog.create({ data: { organizationId: user.organizationId, userId: user.id, action: "auth.login", entity: "User", entityId: user.id, ip } });
  return ok({ id: user.id, name: user.name });
});

