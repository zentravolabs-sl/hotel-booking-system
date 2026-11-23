import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit } from "@/lib/http";
import { updateCleaningTask, inspectCleaningTask } from "@/modules/operations/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("housekeeping:read");
  const { propertyId, status } = z
    .object({
      propertyId: z.string().min(1),
      status: z.enum(["DIRTY", "IN_PROGRESS", "CLEAN", "INSPECTED"]).optional(),
    })
    .parse(searchParams(req));
  await assertPropertyAccess(ctx, propertyId);

  const [tasks, cabanas, lostFound, staff] = await Promise.all([
    db.cleaningTask.findMany({
      where: { organizationId: ctx.organizationId, propertyId, ...(status ? { status } : {}) },
      include: { inspection: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.cabana.findMany({
      where: { organizationId: ctx.organizationId, propertyId, archivedAt: null },
      select: { id: true, code: true, name: true, zone: true, status: true, cleaningStatus: true },
      orderBy: { code: "asc" },
    }),
    db.lostFoundItem.findMany({
      where: { organizationId: ctx.organizationId, propertyId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.employee.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true, employeeNo: true, position: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const cabMap = new Map(cabanas.map((c) => [c.id, c]));
  return ok({
    tasks: tasks.map((t) => ({ ...t, cabana: cabMap.get(t.cabanaId) ?? null })),
    cabanas,
    lostFound,
    staff,
    canInspect: ctx.permissions.has("housekeeping:inspect"),
  });
});

const createSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("task"),
    propertyId: z.string().min(1),
    cabanaId: z.string().min(1),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
    assignedToId: z.string().optional(),
  }),
  z.object({
    action: z.literal("lost_found"),
    propertyId: z.string().min(1),
    description: z.string().trim().min(2).max(300),
    foundAt: z.string().trim().max(120).optional(),
  }),
  z.object({
    action: z.literal("claim_lost_found"),
    itemId: z.string().min(1),
  }),
]);

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("housekeeping:manage");
  const body = await parseBody(req, createSchema);

  if (body.action === "lost_found") {
    await assertPropertyAccess(ctx, body.propertyId);
    const item = await db.lostFoundItem.create({
      data: {
        organizationId: ctx.organizationId,
        propertyId: body.propertyId,
        description: body.description,
        foundAt: body.foundAt,
      },
    });
    await audit(ctx, "lostFound.create", "LostFoundItem", item.id);
    return ok(item, 201);
  }

  if (body.action === "claim_lost_found") {
    const res = await db.lostFoundItem.updateMany({
      where: { id: body.itemId, organizationId: ctx.organizationId },
      data: { claimedAt: new Date() },
    });
    if (!res.count) throw notFound("Lost & found item not found");
    return ok({ claimed: true });
  }

  await assertPropertyAccess(ctx, body.propertyId);
  const cab = await db.cabana.findFirst({
    where: { id: body.cabanaId, propertyId: body.propertyId, organizationId: ctx.organizationId },
  });
  if (!cab) throw notFound("Cabana not found");

  const [task] = await db.$transaction([
    db.cleaningTask.create({
      data: {
        organizationId: ctx.organizationId,
        propertyId: body.propertyId,
        cabanaId: body.cabanaId,
        priority: body.priority,
        assignedToId: body.assignedToId ?? null,
        status: "DIRTY",
        checklist: [
          { item: "Replace bed linens & bath towels", done: false },
          { item: "Sanitize bathroom & restock amenities", done: false },
          { item: "Sweep deck, furniture & plunge pool area", done: false },
        ],
      },
    }),
    db.cabana.update({
      where: { id: cab.id },
      data: {
        cleaningStatus: "DIRTY",
        ...(cab.status === "AVAILABLE" ? { status: "CLEANING" } : {}),
      },
    }),
  ]);
  await audit(ctx, "cleaningTask.create", "CleaningTask", task.id);
  return ok(task, 201);
});

const patchSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("update"),
    taskId: z.string().min(1),
    status: z.enum(["DIRTY", "IN_PROGRESS", "CLEAN"]).optional(),
    assignedToId: z.string().nullable().optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    checklist: z.array(z.object({ item: z.string(), done: z.boolean() })).optional(),
  }),
  z.object({
    mode: z.literal("inspect"),
    taskId: z.string().min(1),
    approved: z.boolean(),
    notes: z.string().max(300).optional(),
  }),
]);

export const PATCH = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await parseBody(req, patchSchema);

  if (body.mode === "inspect") {
    const ctx = await requirePermission("housekeeping:inspect");
    const res = await inspectCleaningTask({
      organizationId: ctx.organizationId,
      taskId: body.taskId,
      approved: body.approved,
      notes: body.notes,
      inspectorId: ctx.userId,
    });
    await audit(ctx, "cleaningTask.inspect", "CleaningTask", body.taskId, { approved: body.approved });
    return ok(res);
  }

  const ctx = await requirePermission("housekeeping:manage");
  const updated = await updateCleaningTask({
    organizationId: ctx.organizationId,
    taskId: body.taskId,
    status: body.status,
    assignedToId: body.assignedToId,
    priority: body.priority,
    checklist: body.checklist,
    userId: ctx.userId,
  });
  await audit(ctx, "cleaningTask.update", "CleaningTask", body.taskId, { status: body.status });
  return ok(updated);
});

