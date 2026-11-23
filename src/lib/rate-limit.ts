import { HttpError } from "./api";

// In-memory fixed-window limiter. Swap the store for Redis (INCR + EXPIRE) when REDIS_URL is configured.
const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  h.n++;
  if (h.n > limit) throw new HttpError(429, "Too many requests. Try again later.", "RATE_LIMITED");
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

