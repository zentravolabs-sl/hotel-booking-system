import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  generateTwoFactorSecret,
  generateTotpCode,
  verifyTotpCode,
  requestPasswordReset,
  confirmPasswordReset,
  confirmEmailVerification,
  configureTwoFactor,
} from "./security";
import { randomToken, sha256 } from "./session";

const tag = `p11_${Date.now()}`;
let userId = "";
const email = `sec-${tag}@example.com`;

beforeAll(async () => {
  let role = await db.role.findFirst({ where: { organizationId: null, key: "CUSTOMER" } });
  role ??= await db.role.create({ data: { key: "CUSTOMER", name: "Customer", isSystem: true } });
  const u = await db.user.create({
    data: {
      email,
      name: "Sec User",
      passwordHash: await bcrypt.hash("InitialPass123", 12),
      roleId: role.id,
      status: "PENDING",
    },
  });
  userId = u.id;
});

afterAll(async () => {
  await db.authToken.deleteMany({ where: { userId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
});

describe("Phase 11: Security hardening — email verification, password reset & TOTP 2FA", () => {
  it("generates and verifies RFC-6238 TOTP 6-digit codes and rejects wrong codes", () => {
    const secret = generateTwoFactorSecret();
    const now = 1_800_000_000_000;
    const code = generateTotpCode(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code, now)).toBe(true);
    expect(verifyTotpCode(secret, "000000", now)).toBe(code === "000000");
  });

  it("verifies email tokens, completes password reset with session revocation, and enables/disables 2FA", async () => {
    // 1) Email verification
    const rawVerify = randomToken();
    await db.authToken.create({
      data: {
        userId,
        type: "EMAIL_VERIFY",
        tokenHash: sha256(rawVerify),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await confirmEmailVerification(rawVerify);
    const verifiedUser = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(verifiedUser.status).toBe("ACTIVE");
    expect(verifiedUser.emailVerifiedAt).not.toBeNull();

    // 2) Password reset flow
    const req = await requestPasswordReset(email);
    expect(req.issued).toBe(true);
    expect(req.devToken).toBeTruthy();

    await confirmPasswordReset(req.devToken!, "UpdatedPass999");
    const updatedUser = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await bcrypt.compare("UpdatedPass999", updatedUser.passwordHash)).toBe(true);

    // Reusing the same reset token must fail
    await expect(confirmPasswordReset(req.devToken!, "AnotherPass999")).rejects.toMatchObject({ status: 400 });

    // 3) Configure 2FA
    const step1 = await configureTwoFactor(userId, true);
    expect(step1.setupSecret).toBeTruthy();
    const step2 = await configureTwoFactor(userId, true, step1.sampleCurrentCode);
    expect(step2.twoFactorEnabled).toBe(true);
  }, 60_000);
});

