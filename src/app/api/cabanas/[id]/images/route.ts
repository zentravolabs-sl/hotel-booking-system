import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, badRequest } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit } from "@/lib/http";
import { loadCabana } from "@/modules/cabanas/access";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

// Phase 2 accepts https image URLs (e.g. Cloudinary delivery URLs). Signed direct uploads arrive with the media phase.
const schema = z.object({
  url: z.string().url().max(500).refine((u) => u.startsWith("https://"), "Image URL must use https"),
  publicId: z.string().max(200).optional(),
  alt: z.string().max(150).optional(),
});

export const POST = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("cabana:manage");
  const { id } = await params;
  await loadCabana(ctx, id);
  const body = await parseBody(req, schema);
  const count = await db.cabanaImage.count({ where: { cabanaId: id } });
  if (count >= 20) throw badRequest("A cabana can have at most 20 images");
  const img = await db.cabanaImage.create({ data: { ...body, cabanaId: id, sortOrder: count } });
  await audit(ctx, "cabana.image.add", "Cabana", id);
  return ok(img, 201);
});

export const DELETE = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("cabana:manage");
  const { id } = await params;
  await loadCabana(ctx, id);
  const { imageId } = z.object({ imageId: z.string().min(1) }).parse(searchParams(req));
  await db.cabanaImage.deleteMany({ where: { id: imageId, cabanaId: id } });
  await audit(ctx, "cabana.image.remove", "Cabana", id);
  return ok({ removed: true });
});
