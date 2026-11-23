import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("finance:read");
  const { propertyId } = z.object({ propertyId: z.string().optional() }).parse(searchParams(req));
  if (propertyId) await assertPropertyAccess(ctx, propertyId);

  const [categories, expenses] = await Promise.all([
    db.expenseCategory.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: "asc" } }),
    db.expense.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, ...(propertyId ? { propertyId } : {}) },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { incurredOn: "desc" },
      take: 100,
    }),
  ]);
  return ok({ categories, expenses });
});

const schema = z.object({
  propertyId: z.string().min(1),
  categoryName: z.string().trim().min(2).max(60),
  description: z.string().trim().min(2).max(200),
  amount: z.number().min(0.01).max(100_000_000),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("finance:manage");
  const body = await parseBody(req, schema);
  await assertPropertyAccess(ctx, body.propertyId);

  const cat = await db.expenseCategory.upsert({
    where: { organizationId_name: { organizationId: ctx.organizationId, name: body.categoryName } },
    update: {},
    create: { organizationId: ctx.organizationId, name: body.categoryName },
  });

  const exp = await db.expense.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: body.propertyId,
      categoryId: cat.id,
      description: body.description,
      amount: body.amount.toFixed(2),
      incurredOn: new Date(`${body.incurredOn}T00:00:00.000Z`),
      createdById: ctx.userId,
    },
    include: { category: true },
  });
  await audit(ctx, "expense.create", "Expense", exp.id, { amount: body.amount });
  return ok(exp, 201);
});

export const DELETE = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("finance:manage");
  const { id } = z.object({ id: z.string().min(1) }).parse(searchParams(req));
  const res = await db.expense.updateMany({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!res.count) throw notFound("Expense not found");
  await audit(ctx, "expense.delete", "Expense", id);
  return ok({ deleted: true });
});

