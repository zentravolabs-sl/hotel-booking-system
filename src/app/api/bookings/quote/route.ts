import { route, ok } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody } from "@/lib/http";
import { computeBookingQuote, previewQuoteSchema } from "@/modules/bookings/operations";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("booking:read");
  const input = await parseBody(req, previewQuoteSchema);
  await assertPropertyAccess(ctx, input.propertyId);
  return ok(await computeBookingQuote(ctx.organizationId, input));
});

