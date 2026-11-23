import { z } from "zod";

export const cabanaSchema = z.object({
  propertyId: z.string().min(1),
  typeId: z.string().nullable().optional(),
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9-_]+$/, "Letters, numbers, - and _ only"),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(3000).optional(),
  zone: z.string().trim().max(60).optional(),
  maxAdults: z.number().int().min(1).max(30),
  maxChildren: z.number().int().min(0).max(30),
  bedConfig: z.array(z.object({ type: z.string().min(1).max(30), count: z.number().int().min(1).max(10) })).max(6).optional(),
  hourlyEnabled: z.boolean().default(true),
  overnightEnabled: z.boolean().default(true),
  featured: z.boolean().default(false),
  amenityIds: z.array(z.string()).max(60).default([]),
});

