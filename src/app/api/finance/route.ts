import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit } from "@/lib/http";
import { computeFinancialSummary } from "@/modules/finance/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("finance:read");
  const q = z
    .object({
      propertyId: z.string().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    })
    .parse(searchParams(req));

  if (q.propertyId) await assertPropertyAccess(ctx, q.propertyId);

  const now = new Date();
  const from = q.from ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const to = q.to ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [summary, closings] = await Promise.all([
    computeFinancialSummary({
      organizationId: ctx.organizationId,
      propertyId: q.propertyId,
      from,
      to,
    }),
    db.cashRegisterClosing.findMany({
      where: { organizationId: ctx.organizationId, ...(q.propertyId ? { propertyId: q.propertyId } : {}) },
      orderBy: { businessDate: "desc" },
      take: 30,
    }),
  ]);

  return ok({ from: from.toISOString(), to: to.toISOString(), summary, closings });
});

const closeSchema = z.object({
  propertyId: z.string().min(1),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  countedCash: z.number().min(0).max(100_000_000),
});

/** Daily cash register closing & reconciliation. Computes expected cash from day's CASH payments minus CASH refunds. */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("finance:manage");
  const body = await parseBody(req, closeSchema);
  await assertPropertyAccess(ctx, body.propertyId);

  const dayStart = new Date(`${body.businessDate}T00:00:00.000Z`);
  const dayEnd = new Date(`${body.businessDate}T23:59:59.999Z`);

  const cashPayments = await db.payment.findMany({
    where: {
      organizationId: ctx.organizationId,
      method: "CASH",
      status: "SUCCEEDED",
      paidAt: { gte: dayStart, lte: dayEnd },
    },
    include: { refunds: { where: { status: { in: ["APPROVED", "PROCESSED"] } } } },
  });

  let expected = new Prisma.Decimal(0);
  for (const p of cashPayments) {
    expected = expected.plus(p.amount);
    for (const r of p.refunds) expected = expected.minus(r.amount);
  }

  const closing = await db.cashRegisterClosing.upsert({
    where: { propertyId_businessDate: { propertyId: body.propertyId, businessDate: dayStart } },
    update: { expectedCash: expected, countedCash: body.countedCash.toFixed(2), closedById: ctx.userId },
    create: {
      organizationId: ctx.organizationId,
      propertyId: body.propertyId,
      businessDate: dayStart,
      expectedCash: expected,
      countedCash: body.countedCash.toFixed(2),
      closedById: ctx.userId,
    },
  });

  await audit(ctx, "cashRegister.close", "CashRegisterClosing", closing.id, {
    businessDate: body.businessDate,
    expected: expected.toFixed(2),
    counted: body.countedCash.toFixed(2),
  });
  return ok(closing, 201);
});

