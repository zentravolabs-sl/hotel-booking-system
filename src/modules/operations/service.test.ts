import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  updateCleaningTask,
  inspectCleaningTask,
  completeAndApproveMaintenance,
  sanitizeEmployee,
  assertPayrollAccess,
} from "./service";

const tag = `p6_${Date.now()}`;
let orgId = "", propertyId = "", cabanaId = "", taskId = "";

beforeAll(async () => {
  const o = await db.organization.create({ data: { name: tag, slug: tag } });
  orgId = o.id;
  const p = await db.property.create({
    data: {
      organizationId: orgId,
      name: "P6 Resort",
      slug: "p6-resort",
      settings: { create: { requireInspection: true } },
    },
  });
  propertyId = p.id;
  const c = await db.cabana.create({
    data: {
      organizationId: orgId,
      propertyId,
      code: "C-P6",
      name: "Palm Cabana",
      status: "CLEANING",
      cleaningStatus: "DIRTY",
    },
  });
  cabanaId = c.id;
  const t = await db.cleaningTask.create({
    data: {
      organizationId: orgId,
      propertyId,
      cabanaId,
      status: "DIRTY",
      priority: "HIGH",
    },
  });
  taskId = t.id;
});

afterAll(async () => {
  await db.maintenanceRequest.deleteMany({ where: { organizationId: orgId } });
  await db.inspection.deleteMany({ where: { task: { organizationId: orgId } } });
  await db.cleaningTask.deleteMany({ where: { organizationId: orgId } });
  await db.cabana.deleteMany({ where: { organizationId: orgId } });
  await db.organization.deleteMany({ where: { id: orgId } });
});

describe("Phase 6: Housekeeping inspection gate, maintenance restoration & payroll authorization", () => {
  it("strips baseSalary and blocks payroll access when caller lacks payroll:read", () => {
    expect(sanitizeEmployee({ name: "Emp", baseSalary: "75000.00" }, false)).toEqual({ name: "Emp", baseSalary: null });
    expect(sanitizeEmployee({ name: "Emp", baseSalary: "75000.00" }, true)).toEqual({ name: "Emp", baseSalary: "75000.00" });
    expect(() => assertPayrollAccess(new Set(["staff:read"]))).toThrow();
    expect(() => assertPayrollAccess(new Set(["staff:read", "payroll:read"]))).not.toThrow();
  });

  it("keeps cabana in CLEANING after attendant marks CLEAN until inspector approves, and restores MAINTENANCE upon repair sign-off", async () => {
    // 1) Attendant marks task CLEAN -> because requireInspection is true, cabana MUST stay CLEANING
    await updateCleaningTask({
      organizationId: orgId,
      taskId,
      status: "CLEAN",
      userId: null,
    });
    const afterClean = await db.cabana.findUniqueOrThrow({ where: { id: cabanaId } });
    expect(afterClean.cleaningStatus).toBe("CLEAN");
    expect(afterClean.status).toBe("CLEANING");

    // 2) Inspector rejects -> returns to DIRTY and remains CLEANING
    await inspectCleaningTask({
      organizationId: orgId,
      taskId,
      approved: false,
      notes: "Mirror smudges",
      inspectorId: null,
    });
    const afterReject = await db.cabana.findUniqueOrThrow({ where: { id: cabanaId } });
    expect(afterReject.cleaningStatus).toBe("DIRTY");
    expect(afterReject.status).toBe("CLEANING");

    // 3) Re-clean and approve inspection -> releases cabana to AVAILABLE!
    await updateCleaningTask({ organizationId: orgId, taskId, status: "CLEAN", userId: null });
    await inspectCleaningTask({ organizationId: orgId, taskId, approved: true, inspectorId: null });
    const afterApprove = await db.cabana.findUniqueOrThrow({ where: { id: cabanaId } });
    expect(afterApprove.cleaningStatus).toBe("INSPECTED");
    expect(afterApprove.status).toBe("AVAILABLE");

    // 4) Put cabana into MAINTENANCE and approve repair completion -> restores to AVAILABLE
    await db.cabana.update({ where: { id: cabanaId }, data: { status: "MAINTENANCE" } });
    const mReq = await db.maintenanceRequest.create({
      data: {
        organizationId: orgId,
        propertyId,
        cabanaId,
        title: "Replace deck spotlight",
        status: "IN_PROGRESS",
      },
    });
    await completeAndApproveMaintenance({
      organizationId: orgId,
      requestId: mReq.id,
      status: "APPROVED",
      cost: 4500,
      userId: null,
    });
    const afterMaint = await db.cabana.findUniqueOrThrow({ where: { id: cabanaId } });
    expect(afterMaint.status).toBe("AVAILABLE");
  }, 60_000);
});

