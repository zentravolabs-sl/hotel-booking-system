import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "../db";

export const SESSION_COOKIE = "cp_session";
const SESSION_DAYS = 14;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string } = {}) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.session.create({ data: { userId, tokenHash: sha256(token), expiresAt, ...meta } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // CSRF mitigation; mutating routes also check Origin (see assertSameOrigin)
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Server-side lookup; the only source of truth for who the caller is and which tenant they belong to. */
export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: { include: { role: { include: { permissions: { include: { permission: true } } } }, properties: true } },
    },
  });
  if (!s || s.expiresAt < new Date()) return null;
  const u = s.user;
  if (u.deletedAt || u.status !== "ACTIVE") return null;
  return u;
}

/** Reject cross-site mutating requests (defence in depth on top of SameSite=Lax). */
export function assertSameOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("host");
  if (new URL(origin).host !== host) throw new Error("CSRF_ORIGIN_MISMATCH");
}

