import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { route, ok, conflict, notFound } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, searchParams, audit, isUniqueViolation } from "@/lib/http";
import { sanitizeEmployee, assertPayrollAccess } from "@/modules/operations/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("staff:read");
  const { view } = z.object({ view: z.enum(["all", "payroll"]).default("all") }).parse(searchParams(req));
  const canPayroll = ctx.permissions.has("payroll:read");

  if (view === "payroll") {
    assertPayrollAccess(ctx.permissions);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayDate = new Date(`${todayIso}T00:00:00.000Z`);

  const [departments, employees, leaves, shifts] = await Promise.all([
    db.department.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: "asc" } }),
    db.employee.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      include: {
        department: { select: { id: true, name: true } },
        attendance: { where: { date: todayDate }, take: 1 },
        _count: { select: { attendance: true, leaves: true } },
      },
      orderBy: { employeeNo: "asc" },
    }),
    db.leave.findMany({
      where: { employee: { organizationId: ctx.organizationId } },
      include: { employee: { select: { id: true, name: true, employeeNo: true } } },
      orderBy: { fromDate: "desc" },
      take: 50,
    }),
    db.shift.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { startsAt: "desc" },
      take: 50,
    }),
  ]);

  let totalMonthlyPayroll = new Prisma.Decimal(0);
  if (canPayroll) {
    for (const e of employees) {
      if (e.baseSalary) totalMonthlyPayroll = totalMonthlyPayroll.plus(e.baseSalary);
    }
  }

  return ok({
    canPayroll,
    departments,
    employees: employees.map((e) => sanitizeEmployee(e, canPayroll)),
    leaves,
    shifts,
    payrollSummary: canPayroll ? { totalMonthlyPayroll: totalMonthlyPayroll.toFixed(2), headcount: employees.length } : null,
  });
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("employee"),
    employeeNo: z.string().trim().min(1).max(30),
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().max(30).optional(),
    position: z.string().trim().max(80).optional(),
    departmentName: z.string().trim().max(60).optional(),
    baseSalary: z.number().min(0).max(100_000_000).optional(),
  }),
  z.object({
    action: z.literal("attendance"),
    employeeId: z.string().min(1),
    clock: z.enum(["IN", "OUT"]),
  }),
  z.object({
    action: z.literal("leave"),
    employeeId: z.string().min(1),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal("leave_status"),
    leaveId: z.string().min(1),
    status: z.enum(["APPROVED", "REJECTED"]),
  }),
  z.object({
    action: z.literal("shift"),
    employeeId: z.string().min(1),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  }),
]);

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("staff:manage");
  const body = await parseBody(req, actionSchema);

  if (body.action === "employee") {
    if (body.baseSalary !== undefined) assertPayrollAccess(ctx.permissions);
    let departmentId: string | null = null;
    if (body.departmentName) {
      const dept = await db.department.upsert({
        where: { organizationId_name: { organizationId: ctx.organizationId, name: body.departmentName } },
        update: {},
        create: { organizationId: ctx.organizationId, name: body.departmentName },
      });
      departmentId = dept.id;
    }
    try {
      const emp = await db.employee.create({
        data: {
          organizationId: ctx.organizationId,
          employeeNo: body.employeeNo,
          name: body.name,
          phone: body.phone,
          position: body.position,
          departmentId,
          baseSalary: body.baseSalary != null ? body.baseSalary.toFixed(2) : null,
          hiredOn: new Date(),
        },
      });
      await audit(ctx, "employee.create", "Employee", emp.id);
      return ok(sanitizeEmployee(emp, ctx.permissions.has("payroll:read")), 201);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict(`Employee number "${body.employeeNo}" already exists`);
      throw e;
    }
  }

  if (body.action === "attendance") {
    const emp = await db.employee.findFirst({ where: { id: body.employeeId, organizationId: ctx.organizationId } });
    if (!emp) throw notFound("Employee not found");
    const todayIso = new Date().toISOString().slice(0, 10);
    const date = new Date(`${todayIso}T00:00:00.000Z`);
    const now = new Date();
    const att = await db.attendance.upsert({
      where: { employeeId_date: { employeeId: emp.id, date } },
      update: body.clock === "IN" ? { clockIn: now } : { clockOut: now },
      create: { employeeId: emp.id, date, clockIn: now, ...(body.clock === "OUT" ? { clockOut: now } : {}) },
    });
    return ok(att);
  }

  if (body.action === "leave") {
    const emp = await db.employee.findFirst({ where: { id: body.employeeId, organizationId: ctx.organizationId } });
    if (!emp) throw notFound("Employee not found");
    const leave = await db.leave.create({
      data: {
        employeeId: emp.id,
        fromDate: new Date(`${body.fromDate}T00:00:00.000Z`),
        toDate: new Date(`${body.toDate}T00:00:00.000Z`),
        reason: body.reason,
      },
    });
    return ok(leave, 201);
  }

  if (body.action === "leave_status") {
    const leave = await db.leave.findFirst({ where: { id: body.leaveId, employee: { organizationId: ctx.organizationId } } });
    if (!leave) throw notFound("Leave record not found");
    const updated = await db.leave.update({ where: { id: leave.id }, data: { status: body.status } });
    return ok(updated);
  }

  const emp = await db.employee.findFirst({ where: { id: body.employeeId, organizationId: ctx.organizationId } });
  if (!emp) throw notFound("Employee not found");
  const shift = await db.shift.create({
    data: { organizationId: ctx.organizationId, employeeId: emp.id, startsAt: body.startsAt, endsAt: body.endsAt },
  });
  return ok(shift, 201);
});

