import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { requireAuth } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { parseBody } from "@/lib/http";
import {
  requestPasswordReset,
  confirmPasswordReset,
  confirmEmailVerification,
  configureTwoFactor,
} from "@/lib/auth/security";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await requireAuth();
  const u = await db.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      emailVerifiedAt: true,
      twoFactorEnabled: true,
      lastLoginAt: true,
      role: { select: { key: true, name: true } },
    },
  });
  return ok(u);
});

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request_password_reset"),
    email: z.string().email(),
  }),
  z.object({
    action: z.literal("confirm_password_reset"),
    token: z.string().min(10),
    newPassword: z
      .string()
      .min(10)
      .max(128)
      .regex(/[a-z]/, "Lowercase required")
      .regex(/[A-Z]/, "Uppercase required")
      .regex(/\d/, "Number required"),
  }),
  z.object({
    action: z.literal("verify_email"),
    token: z.string().min(10),
  }),
  z.object({
    action: z.literal("update_profile"),
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().max(30).optional(),
  }),
  z.object({
    action: z.literal("configure_2fa"),
    enable: z.boolean(),
    code: z.string().optional(),
  }),
]);

export const POST = route(async (req: Request) => {
  const body = await parseBody(req, postSchema);

  if (body.action === "request_password_reset") {
    rateLimit(`pw_reset:${clientIp(req)}`, 5, 15 * 60_000);
    return ok(await requestPasswordReset(body.email));
  }

  if (body.action === "confirm_password_reset") {
    rateLimit(`pw_confirm:${clientIp(req)}`, 10, 15 * 60_000);
    return ok(await confirmPasswordReset(body.token, body.newPassword));
  }

  if (body.action === "verify_email") {
    return ok(await confirmEmailVerification(body.token));
  }

  assertSameOrigin(req);
  const ctx = await requireAuth();

  if (body.action === "update_profile") {
    const updated = await db.user.update({
      where: { id: ctx.userId },
      data: { name: body.name, phone: body.phone ?? null },
      select: { id: true, name: true, email: true, phone: true },
    });
    return ok(updated);
  }

  return ok(await configureTwoFactor(ctx.userId, body.enable, body.code));
});

