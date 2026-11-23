import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...i: ClassValue[]) => twMerge(clsx(i));

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public fields?: Record<string, string[]>) {
    super(message);
  }
}

export interface ApiResult<T> { data: T; meta?: Record<string, unknown> & { page?: number; pageSize?: number; total?: number; warning?: string } }

/** Typed fetch wrapper for our standardized `{success,data,error}` envelope. */
export async function api<T>(url: string, init?: Omit<RequestInit, "body"> & { body?: unknown }): Promise<ApiResult<T>> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let json: { success: boolean; data?: T; meta?: ApiResult<T>["meta"]; error?: { message: string; code?: string; details?: { fieldErrors?: Record<string, string[]> } } };
  try { json = await res.json(); } catch { throw new ApiError("Unexpected server response", res.status); }
  if (!res.ok || !json.success) {
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(json.error?.message ?? "Request failed", res.status, json.error?.code, json.error?.details?.fieldErrors);
  }
  return { data: json.data as T, meta: json.meta };
}

export const money = (v: string | number, currency = "LKR") =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(v));

