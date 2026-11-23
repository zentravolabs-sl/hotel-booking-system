import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, conflict, notFound } from "@/lib/api";
import { parseBody, isUniqueViolation } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  reference: z.string().trim().min(4).max(40),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(3).max(600),
});

export const POST = route(async (req: Request) => {
  const body = await parseBody(req, schema);
  const b = await db.booking.findUnique({ where: { reference: body.reference.toUpperCase() } });
  if (!b) throw notFound("Booking reference not found");
  try {
    const review = await db.review.create({
      data: {
        organizationId: b.organizationId,
        propertyId: b.propertyId,
        bookingId: b.id,
        rating: body.rating,
        comment: body.comment,
        isPublished: true,
      },
    });
    return ok(review, 201);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A review has already been submitted for this booking");
    throw e;
  }
});

