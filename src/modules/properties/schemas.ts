import { z } from "zod";

export const tz = z.string().refine((v) => {
  try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; }
}, "Unknown timezone");

export const propertySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(2000).optional(),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional(),
  timezone: tz.default("Asia/Colombo"),
  currency: z.string().length(3).default("LKR"),
  parentPropertyId: z.string().optional(),
  isPublic: z.boolean().default(true),
});

