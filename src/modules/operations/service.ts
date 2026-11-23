import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { conflict, forbidden, notFound } from "@/lib/api";

/**
 * Update a cleaning task's status or checklist.
 * CRITICAL REQUIREMENT: Do not automatically mark the cabana AVAILABLE until cleaning AND required inspection are complete!
 * - When `status === "CLEAN"`:
 *   - If property setting `requireInspection` is true (default), the cabana remains in `CLEANING` operational status with `cleaningStatus = "CLEAN"` until an inspector approves it via `inspectCleaningTask`.
 *   - If `requireInspection` is false, it transitions the cabana to `AVAILABLE` (unless the cabana is under `MAINTENANCE`).
 */
export async function updateCleaningTask(params: {
  organizationId: string;
  taskId: string;
  status?: "DIRTY" | "IN_PROGRESS" | "CLEAN";
  assignedToId?: string | null;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  checklist?: { item: string; done: boolean }[];
  userId: string | null;
}) {
  const task = await db.cleaningTask.findFirst({
    where: { id: params.taskId, organizationId: params.organizationId },
  });
  if (!task) throw notFound("Cleaning task not found");

  const [cabana, prop] = await Promise.all([
    db.cabana.findUniqueOrThrow({ where: { id: task.cabanaId } }),
    db.property.findUniqueOrThrow({ where: { id: task.propertyId }, include: { settings: true } }),
  ]);

  const requireInspection = prop.settings?.requireInspection ?? true;
  const nextStatus = params.status ?? task.status;

  return db.$transaction(
    async (tx) => {
      const updated = await tx.cleaningTask.update({
        where: { id: task.id },
        data: {
          status: nextStatus,
          ...(params.assignedToId !== undefined ? { assignedToId: params.assignedToId } : {}),
          ...(params.priority ? { priority: params.priority } : {}),
          ...(params.checklist ? { checklist: params.checklist } : {}),
          ...(nextStatus === "CLEAN" ? { completedAt: new Date() } : {}),
        },
      });

      if (nextStatus === "CLEAN") {
        // Only release to AVAILABLE if requireInspection is false AND cabana is not under MAINTENANCE/INACTIVE
        const releaseToAvailable = !requireInspection && cabana.status === "CLEANING";
        await tx.cabana.update({
          where: { id: cabana.id },
          data: {
            cleaningStatus: "CLEAN",
            ...(releaseToAvailable ? { status: "AVAILABLE" } : {}),
          },
        });
        if (releaseToAvailable) {
          await tx.cabanaStatusHistory.create({
            data: {
              cabanaId: cabana.id,
              fromStatus: cabana.status,
              toStatus: "AVAILABLE",
              reason: "Cleaning completed (inspection not required)",
              changedById: params.userId,
            },
          });
        }
      } else if (nextStatus === "IN_PROGRESS" || nextStatus === "DIRTY") {
        await tx.cabana.update({
          where: { id: cabana.id },
          data: { cleaningStatus: nextStatus },
        });
      }

      return updated;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/**
 * Inspector approval or rejection of a CLEAN task.
 * - If `approved === true`, marks task `INSPECTED`, `cabana.cleaningStatus = "INSPECTED"`, and releases cabana from `CLEANING` to `AVAILABLE` (leaving `MAINTENANCE` untouched if under repair!).
 * - If `approved === false`, returns task and cabana to `DIRTY` so housekeeping re-cleans.
 */
export async function inspectCleaningTask(params: {
  organizationId: string;
  taskId: string;
  approved: boolean;
  notes?: string;
  inspectorId: string | null;
}) {
  const task = await db.cleaningTask.findFirst({
    where: { id: params.taskId, organizationId: params.organizationId },
  });
  if (!task) throw notFound("Cleaning task not found");
  if (task.status !== "CLEAN" && task.status !== "INSPECTED") {
    throw conflict("Task must be marked CLEAN before inspection");
  }

  const cabana = await db.cabana.findUniqueOrThrow({ where: { id: task.cabanaId } });

  return db.$transaction(
    async (tx) => {
      const inspection = await tx.inspection.upsert({
        where: { taskId: task.id },
        update: { approved: params.approved, notes: params.notes, inspectorId: params.inspectorId },
        create: { taskId: task.id, approved: params.approved, notes: params.notes, inspectorId: params.inspectorId },
      });

      const nextTaskStatus = params.approved ? "INSPECTED" : "DIRTY";
      const updatedTask = await tx.cleaningTask.update({
        where: { id: task.id },
        data: { status: nextTaskStatus, ...(params.approved ? {} : { completedAt: null }) },
      });

      // Only release cabana to AVAILABLE if it was in CLEANING; never override MAINTENANCE or OCCUPIED
      const releaseCabana = params.approved && cabana.status === "CLEANING";
      await tx.cabana.update({
        where: { id: cabana.id },
        data: {
          cleaningStatus: nextTaskStatus,
          ...(releaseCabana ? { status: "AVAILABLE" } : {}),
        },
      });

      if (releaseCabana) {
        await tx.cabanaStatusHistory.create({
          data: {
            cabanaId: cabana.id,
            fromStatus: cabana.status,
            toStatus: "AVAILABLE",
            reason: "Housekeeping inspection approved",
            changedById: params.inspectorId,
          },
        });
      }

      return { task: updatedTask, inspection };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/**
 * Create or update a maintenance request.
 * - If linked to a cabana and `lockCabana === true`, puts the cabana into `MAINTENANCE` operational status.
 * - When a maintenance request is `APPROVED` (completion sign-off) and no other open maintenance requests exist on that cabana,
 *   restores the cabana to `AVAILABLE` (if clean/inspected) or `CLEANING` (if dirty).
 */
export async function completeAndApproveMaintenance(params: {
  organizationId: string;
  requestId: string;
  status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "APPROVED" | "CANCELLED";
  assignedToId?: string | null;
  cost?: number | null;
  userId: string | null;
}) {
  const req = await db.maintenanceRequest.findFirst({
    where: { id: params.requestId, organizationId: params.organizationId },
  });
  if (!req) throw notFound("Maintenance request not found");

  return db.$transaction(
    async (tx) => {
      const updated = await tx.maintenanceRequest.update({
        where: { id: req.id },
        data: {
          status: params.status,
          ...(params.assignedToId !== undefined ? { assignedToId: params.assignedToId } : {}),
          ...(params.cost != null ? { cost: new Prisma.Decimal(params.cost.toFixed(2)) } : {}),
          ...(params.status === "COMPLETED" || params.status === "APPROVED" ? { completedAt: new Date() } : {}),
        },
      });

      if (req.cabanaId && (params.status === "APPROVED" || params.status === "CANCELLED")) {
        const remainingOpen = await tx.maintenanceRequest.count({
          where: {
            organizationId: params.organizationId,
            cabanaId: req.cabanaId,
            id: { not: req.id },
            status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED"] },
          },
        });
        if (remainingOpen === 0) {
          const cab = await tx.cabana.findUniqueOrThrow({ where: { id: req.cabanaId } });
          if (cab.status === "MAINTENANCE") {
            const nextStatus = cab.cleaningStatus === "DIRTY" ? "CLEANING" : "AVAILABLE";
            await tx.cabana.update({ where: { id: cab.id }, data: { status: nextStatus } });
            await tx.cabanaStatusHistory.create({
              data: {
                cabanaId: cab.id,
                fromStatus: "MAINTENANCE",
                toStatus: nextStatus,
                reason: `Maintenance ${req.title} ${params.status.toLowerCase()}`,
                changedById: params.userId,
              },
            });
          }
        }
      }

      return updated;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/** Strip `baseSalary` unless the caller holds `payroll:read`. */
export function sanitizeEmployee<T extends { baseSalary?: Prisma.Decimal | string | null }>(
  emp: T,
  canReadPayroll: boolean,
): T {
  if (canReadPayroll) return emp;
  return { ...emp, baseSalary: null };
}

export function assertPayrollAccess(permissions: Set<string>) {
  if (!permissions.has("payroll:read")) {
    throw forbidden("Salary and payroll records are restricted to authorized personnel");
  }
}

