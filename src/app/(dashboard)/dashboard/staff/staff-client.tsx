"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Clock, Lock, Plus, UserCheck, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { api, money } from "@/lib/utils";

interface EmployeeRow {
  id: string; employeeNo: string; name: string; phone: string | null; position: string | null;
  baseSalary: string | null;
  department: { id: string; name: string } | null;
  attendance: { id: string; clockIn: string | null; clockOut: string | null }[];
  _count: { attendance: number; leaves: number };
}
interface LeaveRow {
  id: string; fromDate: string; toDate: string; reason: string | null; status: "PENDING" | "APPROVED" | "REJECTED";
  employee: { id: string; name: string; employeeNo: string };
}
interface StaffFeed {
  canPayroll: boolean;
  departments: { id: string; name: string }[];
  employees: EmployeeRow[];
  leaves: LeaveRow[];
  payrollSummary: { totalMonthlyPayroll: string; headcount: number } | null;
}

export function StaffClient() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"directory" | "leaves" | "payroll">("directory");

  const feed = useQuery({
    queryKey: ["staff"],
    queryFn: async () => (await api<StaffFeed>("/api/staff")).data,
  });

  // New employee form
  const [empNo, setEmpNo] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [position, setPosition] = useState("");
  const [dept, setDept] = useState("Front Office");
  const [salary, setSalary] = useState("");

  const addEmp = useMutation({
    mutationFn: () =>
      api("/api/staff", {
        method: "POST",
        body: {
          action: "employee",
          employeeNo: empNo,
          name,
          phone: phone || undefined,
          position: position || undefined,
          departmentName: dept || undefined,
          ...(feed.data?.canPayroll && salary ? { baseSalary: Number(salary) } : {}),
        },
      }),
    onSuccess: () => {
      setEmpNo(""); setName(""); setPhone(""); setPosition(""); setSalary("");
      qc.invalidateQueries({ queryKey: ["staff"] });
    },
  });

  const clock = useMutation({
    mutationFn: (p: { employeeId: string; clock: "IN" | "OUT" }) =>
      api("/api/staff", { method: "POST", body: { action: "attendance", ...p } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });

  // Leave form
  const [lEmp, setLEmp] = useState("");
  const [lFrom, setLFrom] = useState("");
  const [lTo, setLTo] = useState("");
  const [lReason, setLReason] = useState("");

  const requestLeave = useMutation({
    mutationFn: () =>
      api("/api/staff", {
        method: "POST",
        body: {
          action: "leave",
          employeeId: lEmp || feed.data?.employees[0]?.id,
          fromDate: lFrom,
          toDate: lTo,
          reason: lReason || undefined,
        },
      }),
    onSuccess: () => { setLReason(""); qc.invalidateQueries({ queryKey: ["staff"] }); },
  });

  const decideLeave = useMutation({
    mutationFn: (p: { leaveId: string; status: "APPROVED" | "REJECTED" }) =>
      api("/api/staff", { method: "POST", body: { action: "leave_status", ...p } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Staff, Attendance & Payroll</h1>
          <p className="text-sm text-muted">Employee directory, departments, daily clock-in/out, leave approvals and restricted payroll summaries.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {([
          { k: "directory", label: "Employees & Attendance", icon: Users },
          { k: "leaves", label: "Leave Management", icon: CalendarOff },
          { k: "payroll", label: "Payroll Summary", icon: Wallet },
        ] as const).map((t) => (
          <button
            key={t.k} onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t.k ? "bg-teal text-white" : "text-muted hover:bg-surface-2"}`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {feed.error && <ErrorState message={(feed.error as Error).message} onRetry={() => feed.refetch()} />}
      {feed.isLoading && <Skeleton className="h-64" />}

      {tab === "directory" && feed.data && (
        <div className="space-y-5">
          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Register Employee</h3>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Employee # *"><Input placeholder="EMP-01" value={empNo} onChange={(e) => setEmpNo(e.target.value)} /></Field>
              <Field label="Full name *"><Input placeholder="Dilshan Perera" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Department"><Input placeholder="Housekeeping" value={dept} onChange={(e) => setDept(e.target.value)} /></Field>
              <Field label="Role / Position"><Input placeholder="Supervisor" value={position} onChange={(e) => setPosition(e.target.value)} /></Field>
              <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
              {feed.data.canPayroll && (
                <Field label="Base Salary (LKR)"><Input type="number" step="0.01" value={salary} onChange={(e) => setSalary(e.target.value)} /></Field>
              )}
            </div>
            {addEmp.error && <p className="mt-2 text-xs text-danger">{(addEmp.error as Error).message}</p>}
            <div className="mt-3 flex justify-end">
              <Button disabled={!empNo.trim() || name.trim().length < 2} loading={addEmp.isPending} onClick={() => addEmp.mutate()}>
                <Plus className="size-4" /> Register Employee
              </Button>
            </div>
          </Card>

          {feed.data.employees.length === 0 ? (
            <EmptyState title="No employees registered" text="Add your resort staff above to track attendance, tasks and payroll." />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead className="border-b border-border text-left text-muted">
                  <tr>
                    {["Emp #", "Name", "Department", "Position", "Today's Attendance", ...(feed.data.canPayroll ? ["Base Salary"] : []), ""].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {feed.data.employees.map((e) => {
                    const todayAtt = e.attendance[0];
                    return (
                      <tr key={e.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-mono text-xs font-semibold">{e.employeeNo}</td>
                        <td className="px-4 py-3 font-medium">{e.name}</td>
                        <td className="px-4 py-3">{e.department ? <Badge>{e.department.name}</Badge> : "—"}</td>
                        <td className="px-4 py-3 text-muted">{e.position || "—"}</td>
                        <td className="px-4 py-3 text-xs">
                          {todayAtt?.clockIn ? (
                            <span className="text-emerald-600">
                              In: {new Date(todayAtt.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              {todayAtt.clockOut && ` · Out: ${new Date(todayAtt.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                            </span>
                          ) : (
                            <span className="text-muted">Not clocked in</span>
                          )}
                        </td>
                        {feed.data.canPayroll && (
                          <td className="px-4 py-3 font-medium">{e.baseSalary ? money(e.baseSalary) : "—"}</td>
                        )}
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-1.5">
                            {!todayAtt?.clockIn && (
                              <Button size="sm" variant="secondary" onClick={() => clock.mutate({ employeeId: e.id, clock: "IN" })}>
                                <Clock className="size-3.5" /> Clock In
                              </Button>
                            )}
                            {todayAtt?.clockIn && !todayAtt.clockOut && (
                              <Button size="sm" variant="secondary" onClick={() => clock.mutate({ employeeId: e.id, clock: "OUT" })}>
                                <UserCheck className="size-3.5" /> Clock Out
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {tab === "leaves" && feed.data && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Employee">
                <Select value={lEmp || feed.data.employees[0]?.id || ""} onChange={(e) => setLEmp(e.target.value)}>
                  {feed.data.employees.map((e) => <option key={e.id} value={e.id}>{e.employeeNo} · {e.name}</option>)}
                </Select>
              </Field>
              <Field label="From date"><Input type="date" value={lFrom} onChange={(e) => setLFrom(e.target.value)} /></Field>
              <Field label="To date"><Input type="date" value={lTo} onChange={(e) => setLTo(e.target.value)} /></Field>
              <Field label="Reason"><Input value={lReason} onChange={(e) => setLReason(e.target.value)} placeholder="Annual / Medical leave" /></Field>
            </div>
            <div className="mt-3 flex justify-end">
              <Button disabled={!feed.data.employees.length || !lFrom || !lTo} loading={requestLeave.isPending} onClick={() => requestLeave.mutate()}>
                <Plus className="size-4" /> Submit Leave Request
              </Button>
            </div>
          </Card>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border text-left text-muted">
                <tr>
                  {["Employee", "Dates", "Reason", "Status", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {feed.data.leaves.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{l.employee.employeeNo} · {l.employee.name}</td>
                    <td className="px-4 py-3 text-xs">{l.fromDate.slice(0, 10)} → {l.toDate.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-muted">{l.reason || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={l.status === "APPROVED" ? "green" : l.status === "REJECTED" ? "red" : "amber"}>{l.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {l.status === "PENDING" && (
                        <div className="inline-flex gap-1.5">
                          <Button size="sm" onClick={() => decideLeave.mutate({ leaveId: l.id, status: "APPROVED" })}>Approve</Button>
                          <Button size="sm" variant="danger" onClick={() => decideLeave.mutate({ leaveId: l.id, status: "REJECTED" })}>Reject</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "payroll" && feed.data && (
        !feed.data.canPayroll ? (
          <Card className="flex flex-col items-center py-12 text-center">
            <Lock className="size-10 text-muted" />
            <h3 className="mt-3 font-semibold">Restricted Access</h3>
            <p className="mt-1 max-w-md text-sm text-muted">
              Salary and payroll summaries are restricted to Owner, General Manager and Accountant roles holding the <code>payroll:read</code> permission.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-5">
              <p className="text-xs text-muted">Active Headcount</p>
              <p className="mt-1 text-2xl font-semibold">{feed.data.payrollSummary?.headcount ?? 0}</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-muted">Monthly Base Payroll Liability</p>
              <p className="mt-1 text-2xl font-semibold text-teal">{money(feed.data.payrollSummary?.totalMonthlyPayroll ?? "0")}</p>
            </Card>
          </div>
        )
      )}
    </div>
  );
}

