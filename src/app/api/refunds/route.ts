import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit } from "@/lib/http";
import { createAndProcessRefund } from "@/modules/finance/service";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await requirePermission("payment:read");
  return ok(
    await db.refund.findMany({
      where: { organizationId: ctx.organizationId },
      include: { payment: { select: { id: true, receiptNo: true, method: true, amount: true, bookingId: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );
});

const schema = z.object({
  paymentId: z.string().min(1),
  amount: z.number().min(0.01).max(100_000_000),
  reason: z.string().trim().min(2, "Provide a refund reason").max(300),
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("payment:refund");
  const body = await parseBody(req, schema);
  const refund = await createAndProcessRefund({
    organizationId: ctx.organizationId,
    paymentId: body.paymentId,
    amount: body.amount,
    reason: body.reason,
    approvedById: ctx.userId,
  });
  await audit(ctx, "refund.process", "Refund", refund.id, { paymentId: body.paymentId, amount: body.amount });
  return ok(refund, 201);
});

