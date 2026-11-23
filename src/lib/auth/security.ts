import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { badRequest, notFound } from "@/lib/api";
import { randomToken, sha256 } from "./session";

/** Generate a 6-digit RFC-6238-compatible TOTP code for a 30-second window. */
export function generateTotpCode(secretHex: string, timestampMs = Date.now()): string {
  const counter = Math.floor(timestampMs / 30_000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", Buffer.from(secretHex, "hex")).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotpCode(secretHex: string, code: string, nowMs = Date.now()): boolean {
  const cleaned = code.trim();
  if (!/^\d{6}$/.test(cleaned)) return false;
  // Allow +/- 1 30s drift window
  for (const offset of [-30_000, 0, 30_000]) {
    if (generateTotpCode(secretHex, nowMs + offset) === cleaned) return true;
  }
  return false;
}

export function generateTwoFactorSecret(): string {
  return randomBytes(20).toString("hex");
}

/** Issue a password-reset token (valid for 1 hour). */
export async function requestPasswordReset(email: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || user.deletedAt) {
    // Do not leak whether the email exists
    return { issued: true, devToken: null };
  }
  const rawToken = randomToken();
  await db.authToken.create({
    data: {
      userId: user.id,
      type: "PASSWORD_RESET",
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return { issued: true, devToken: process.env.NODE_ENV !== "production" ? rawToken : null };
}

/** Consume a password-reset token, update password hash, and revoke existing sessions. */
export async function confirmPasswordReset(rawToken: string, newPassword: string) {
  const tok = await db.authToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
  });
  if (!tok || tok.type !== "PASSWORD_RESET" || tok.usedAt || tok.expiresAt < new Date()) {
    throw badRequest("Password reset token is invalid or expired");
  }
  const hash = await bcrypt.hash(newPassword, 12);
  await db.$transaction([
    db.user.update({
      where: { id: tok.userId },
      data: { passwordHash: hash, failedLogins: 0, lockedUntil: null },
    }),
    db.authToken.update({ where: { id: tok.id }, data: { usedAt: new Date() } }),
    db.session.deleteMany({ where: { userId: tok.userId } }),
  ]);
  return { reset: true };
}

/** Verify an email-verification token and mark the user ACTIVE + emailVerifiedAt. */
export async function confirmEmailVerification(rawToken: string) {
  const tok = await db.authToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
  });
  if (!tok || tok.type !== "EMAIL_VERIFY" || tok.usedAt || tok.expiresAt < new Date()) {
    throw badRequest("Email verification token is invalid or expired");
  }
  await db.$transaction([
    db.user.update({
      where: { id: tok.userId },
      data: { status: "ACTIVE", emailVerifiedAt: new Date() },
    }),
    db.authToken.update({ where: { id: tok.id }, data: { usedAt: new Date() } }),
  ]);
  return { verified: true };
}

/** Enable or disable TOTP 2FA on a user profile. */
export async function configureTwoFactor(userId: string, enable: boolean, verificationCode?: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw notFound("User not found");

  if (!enable) {
    await db.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    return { twoFactorEnabled: false };
  }

  const secret = u.twoFactorSecret ?? generateTwoFactorSecret();
  if (!verificationCode) {
    await db.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });
    return {
      twoFactorEnabled: false,
      setupSecret: secret,
      sampleCurrentCode: generateTotpCode(secret),
    };
  }

  if (!verifyTotpCode(secret, verificationCode)) {
    throw badRequest("Invalid 6-digit 2FA verification code");
  }
  await db.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret, twoFactorEnabled: true },
  });
  return { twoFactorEnabled: true };
}

