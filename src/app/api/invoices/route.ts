import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit } from "@/lib/http";
import { issueBookingInvoice } from "@/modules/finance/service";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await requirePermission("finance:read");
  return ok(
    await db.invoice.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { issuedAt: "desc" },
      take: 100,
    }),
  );
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("payment:collect");
  const { bookingId } = await parseBody(req, z.object({ bookingId: z.string().min(1) }));
  const inv = await issueBookingInvoice(ctx.organizationId, bookingId);
  await audit(ctx, "invoice.issue", "Invoice", inv.id, { bookingId });
  return ok(inv, 201);
});

