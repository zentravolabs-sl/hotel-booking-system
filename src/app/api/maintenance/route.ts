import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, notFound } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit } from "@/lib/http";
import { completeAndApproveMaintenance } from "@/modules/operations/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("cabana:read");
  const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(searchParams(req));
  await assertPropertyAccess(ctx, propertyId);

  const [requests, cabanas, staff] = await Promise.all([
    db.maintenanceRequest.findMany({
      where: { organizationId: ctx.organizationId, propertyId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.cabana.findMany({
      where: { organizationId: ctx.organizationId, propertyId, archivedAt: null },
      select: { id: true, code: true, name: true, status: true },
      orderBy: { code: "asc" },
    }),
    db.employee.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true, position: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const cabMap = new Map(cabanas.map((c) => [c.id, c]));
  return ok({
    requests: requests.map((r) => ({ ...r, cabana: r.cabanaId ? cabMap.get(r.cabanaId) ?? null : null })),
    cabanas,
    staff,
  });
});

const createSchema = z.object({
  propertyId: z.string().min(1),
  cabanaId: z.string().nullable().optional(),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  assignedToId: z.string().nullable().optional(),
  lockCabana: z.boolean().default(true),
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("maintenance:manage");
  const body = await parseBody(req, createSchema);
  await assertPropertyAccess(ctx, body.propertyId);

  if (body.cabanaId) {
    const cab = await db.cabana.findFirst({
      where: { id: body.cabanaId, propertyId: body.propertyId, organizationId: ctx.organizationId },
    });
    if (!cab) throw notFound("Cabana not found");
    if (body.lockCabana && cab.status !== "OCCUPIED") {
      await db.$transaction([
        db.cabana.update({ where: { id: cab.id }, data: { status: "MAINTENANCE" } }),
        db.cabanaStatusHistory.create({
          data: {
            cabanaId: cab.id,
            fromStatus: cab.status,
            toStatus: "MAINTENANCE",
            reason: `Maintenance: ${body.title}`,
            changedById: ctx.userId,
          },
        }),
      ]);
    }
  }

  const m = await db.maintenanceRequest.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: body.propertyId,
      cabanaId: body.cabanaId ?? null,
      title: body.title,
      description: body.description,
      priority: body.priority,
      assignedToId: body.assignedToId ?? null,
      status: body.assignedToId ? "ASSIGNED" : "OPEN",
    },
  });
  await audit(ctx, "maintenance.create", "MaintenanceRequest", m.id);
  return ok(m, 201);
});

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["ASSIGNED", "IN_PROGRESS", "COMPLETED", "APPROVED", "CANCELLED"]),
  assignedToId: z.string().nullable().optional(),
  cost: z.number().min(0).max(100_000_000).nullable().optional(),
});

export const PATCH = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("maintenance:manage");
  const body = await parseBody(req, patchSchema);
  const updated = await completeAndApproveMaintenance({
    organizationId: ctx.organizationId,
    requestId: body.id,
    status: body.status,
    assignedToId: body.assignedToId,
    cost: body.cost,
    userId: ctx.userId,
  });
  await audit(ctx, "maintenance.update", "MaintenanceRequest", body.id, { status: body.status, cost: body.cost });
  return ok(updated);
});

