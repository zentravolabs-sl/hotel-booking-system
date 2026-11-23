import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "ERROR",
    public details?: unknown,
  ) {
    super(message);
  }
}
export const unauthorized = (m = "Authentication required") => new HttpError(401, m, "UNAUTHORIZED");
export const forbidden = (m = "You do not have permission") => new HttpError(403, m, "FORBIDDEN");
export const notFound = (m = "Not found") => new HttpError(404, m, "NOT_FOUND");
export const conflict = (m: string, code = "CONFLICT") => new HttpError(409, m, code);
export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, "BAD_REQUEST", details);

export const ok = <T>(data: T, status = 200, meta?: Record<string, unknown>) =>
  NextResponse.json({ success: true, data, ...(meta ? { meta } : {}) }, { status });

export function handleError(e: unknown) {
  if (e instanceof HttpError)
    return NextResponse.json(
      { success: false, error: { code: e.code, message: e.message, details: e.details } },
      { status: e.status },
    );
  if (e instanceof ZodError)
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION", message: "Invalid input", details: e.flatten() } },
      { status: 422 },
    );
  console.error("[api] unhandled", e);
  return NextResponse.json(
    { success: false, error: { code: "INTERNAL", message: "Something went wrong" } },
    { status: 500 },
  );
}

/** Wrap a route handler so thrown errors become standard responses. */
export function route<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (e) {
      return handleError(e);
    }
  };
}

