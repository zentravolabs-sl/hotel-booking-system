"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, ClipboardCheck, PackageSearch, Play, Plus, RotateCcw, Sparkles, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, Skeleton, STATUS_TONE } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { PropertySelect, useProperties, usePropertySelection } from "@/components/property-select";
import { api, money } from "@/lib/utils";

interface ChecklistItem { item: string; done: boolean }
interface CleaningTaskRow {
  id: string; cabanaId: string; bookingId: string | null; status: "DIRTY" | "IN_PROGRESS" | "CLEAN" | "INSPECTED";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT"; assignedToId: string | null;
  checklist: ChecklistItem[] | null; dueAt: string | null; completedAt: string | null; createdAt: string;
  cabana: { id: string; code: string; name: string; zone: string | null; status: string; cleaningStatus: string } | null;
  inspection: { id: string; approved: boolean; notes: string | null; createdAt: string } | null;
}
interface CabanaBrief { id: string; code: string; name: string; zone: string | null; status: string; cleaningStatus: string }
interface LostFoundRow { id: string; description: string; foundAt: string | null; claimedAt: string | null; createdAt: string }
interface StaffBrief { id: string; name: string; employeeNo?: string; position: string | null }
interface MaintRow {
  id: string; cabanaId: string | null; title: string; description: string | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "APPROVED" | "CANCELLED";
  assignedToId: string | null; cost: string | null; completedAt: string | null; createdAt: string;
  cabana: { id: string; code: string; name: string; status: string } | null;
}

const CLEAN_TONE: Record<string, "red" | "amber" | "blue" | "green"> = {
  DIRTY: "red", IN_PROGRESS: "amber", CLEAN: "blue", INSPECTED: "green",
};
const PRIO_TONE: Record<string, "gray" | "blue" | "amber" | "red"> = {
  LOW: "gray", NORMAL: "blue", HIGH: "amber", URGENT: "red",
};

export function HousekeepingClient() {
  const qc = useQueryClient();
  const props = useProperties();
  const [pid, setPid] = usePropertySelection(props.data);
  const [tab, setTab] = useState<"tasks" | "maintenance" | "lostfound">("tasks");
  const [statusFilter, setStatusFilter] = useState("");
  const currency = props.data?.find((p) => p.id === pid)?.currency ?? "LKR";

  const hk = useQuery({
    enabled: !!pid,
    queryKey: ["housekeeping", pid, statusFilter],
    queryFn: async () =>
      (await api<{
        tasks: CleaningTaskRow[];
        cabanas: CabanaBrief[];
        lostFound: LostFoundRow[];
        staff: StaffBrief[];
        canInspect: boolean;
      }>(`/api/housekeeping?propertyId=${pid}${statusFilter ? `&status=${statusFilter}` : ""}`)).data,
  });

  const maint = useQuery({
    enabled: !!pid && tab === "maintenance",
    queryKey: ["maintenance", pid],
    queryFn: async () =>
      (await api<{ requests: MaintRow[]; cabanas: CabanaBrief[]; staff: StaffBrief[] }>(`/api/maintenance?propertyId=${pid}`)).data,
  });

  // New cleaning task state
  const [newCabanaId, setNewCabanaId] = useState("");
  const [newPriority, setNewPriority] = useState<"LOW" | "NORMAL" | "HIGH" | "URGENT">("NORMAL");
  const [newAssignee, setNewAssignee] = useState("");

  const createTask = useMutation({
    mutationFn: () =>
      api("/api/housekeeping", {
        method: "POST",
        body: {
          action: "task",
          propertyId: pid,
          cabanaId: newCabanaId || hk.data?.cabanas[0]?.id,
          priority: newPriority,
          assignedToId: newAssignee || undefined,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["housekeeping"] }),
  });

  const patchTask = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/housekeeping", { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["housekeeping"] });
      qc.invalidateQueries({ queryKey: ["frontdesk"] });
      qc.invalidateQueries({ queryKey: ["cabanas"] });
    },
  });

  // Lost & found
  const [lfDesc, setLfDesc] = useState("");
  const [lfWhere, setLfWhere] = useState("");
  const createLf = useMutation({
    mutationFn: () =>
      api("/api/housekeeping", {
        method: "POST",
        body: { action: "lost_found", propertyId: pid, description: lfDesc, foundAt: lfWhere || undefined },
      }),
    onSuccess: () => { setLfDesc(""); setLfWhere(""); qc.invalidateQueries({ queryKey: ["housekeeping"] }); },
  });
  const claimLf = useMutation({
    mutationFn: (itemId: string) => api("/api/housekeeping", { method: "POST", body: { action: "claim_lost_found", itemId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["housekeeping"] }),
  });

  // Maintenance
  const [mCabanaId, setMCabanaId] = useState("");
  const [mTitle, setMTitle] = useState("");
  const [mDesc, setMDesc] = useState("");
  const [mPrio, setMPrio] = useState<"LOW" | "NORMAL" | "HIGH" | "URGENT">("HIGH");
  const [mLock, setMLock] = useState(true);
  const [mCostMap, setMCostMap] = useState<Record<string, string>>({});

  const createMaint = useMutation({
    mutationFn: () =>
      api("/api/maintenance", {
        method: "POST",
        body: {
          propertyId: pid,
          cabanaId: mCabanaId || null,
          title: mTitle,
          description: mDesc || undefined,
          priority: mPrio,
          lockCabana: mLock,
        },
      }),
    onSuccess: () => {
      setMTitle(""); setMDesc("");
      qc.invalidateQueries({ queryKey: ["maintenance"] });
      qc.invalidateQueries({ queryKey: ["housekeeping"] });
      qc.invalidateQueries({ queryKey: ["cabanas"] });
    },
  });

  const patchMaint = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/maintenance", { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance"] });
      qc.invalidateQueries({ queryKey: ["housekeeping"] });
      qc.invalidateQueries({ queryKey: ["cabanas"] });
    },
  });

  const staffMap = new Map(hk.data?.staff.map((s) => [s.id, s.name]) ?? []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Housekeeping & Maintenance</h1>
          <p className="text-sm text-muted">Cleaning tasks, checklists, inspection sign-off, lost &amp; found and engineering repairs.</p>
        </div>
        <div className="flex items-center gap-2">
          {props.data && <PropertySelect props={props.data} value={pid} onChange={setPid} />}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {([
          { k: "tasks", label: "Cleaning & Inspections", icon: Sparkles },
          { k: "maintenance", label: "Maintenance & Repairs", icon: Wrench },
          { k: "lostfound", label: "Lost & Found", icon: PackageSearch },
        ] as const).map((t) => (
          <button
            key={t.k} onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t.k ? "bg-teal text-white" : "text-muted hover:bg-surface-2"}`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {hk.error && <ErrorState message={(hk.error as Error).message} onRetry={() => hk.refetch()} />}
      {hk.isLoading && <Skeleton className="h-64" />}

      {tab === "tasks" && hk.data && (
        <div className="space-y-5">
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Cabana">
                <Select value={newCabanaId || hk.data.cabanas[0]?.id || ""} onChange={(e) => setNewCabanaId(e.target.value)} className="w-48">
                  {hk.data.cabanas.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </Select>
              </Field>
              <Field label="Priority">
                <Select value={newPriority} onChange={(e) => setNewPriority(e.target.value as typeof newPriority)} className="w-36">
                  {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}
                </Select>
              </Field>
              <Field label="Assign attendant">
                <Select value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)} className="w-48">
                  <option value="">Unassigned</option>
                  {hk.data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Button disabled={!hk.data.cabanas.length} loading={createTask.isPending} onClick={() => createTask.mutate()}>
                <Plus className="size-4" /> Schedule Cleaning
              </Button>
              <div className="ml-auto">
                <Field label="Filter status">
                  <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
                    <option value="">All tasks</option>
                    {["DIRTY", "IN_PROGRESS", "CLEAN", "INSPECTED"].map((s) => <option key={s}>{s}</option>)}
                  </Select>
                </Field>
              </div>
            </div>
          </Card>

          {hk.data.tasks.length === 0 ? (
            <EmptyState title="No cleaning tasks" text="Tasks are created automatically upon guest check-out or scheduled above." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {hk.data.tasks.map((t) => {
                const list: ChecklistItem[] = Array.isArray(t.checklist) ? t.checklist : [];
                return (
                  <Card key={t.id} className="space-y-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">
                          {t.cabana ? `${t.cabana.code} · ${t.cabana.name}` : "Cabana"}
                        </h3>
                        <p className="text-xs text-muted">
                          Attendant: <b>{t.assignedToId ? staffMap.get(t.assignedToId) ?? "Assigned" : "Unassigned"}</b>
                          {t.cabana && <> · Operational status: <Badge tone={STATUS_TONE[t.cabana.status]}>{t.cabana.status}</Badge></>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={PRIO_TONE[t.priority]}>{t.priority}</Badge>
                        <Badge tone={CLEAN_TONE[t.status]}>{t.status}</Badge>
                      </div>
                    </div>

                    {list.length > 0 && (
                      <div className="space-y-1.5 rounded-xl border border-border bg-surface-2/40 p-3">
                        {list.map((c, idx) => (
                          <Checkbox
                            key={idx}
                            label={c.item}
                            checked={c.done}
                            disabled={t.status === "INSPECTED"}
                            onChange={(e) => {
                              const next = list.map((x, j) => (j === idx ? { ...x, done: e.target.checked } : x));
                              patchTask.mutate({ mode: "update", taskId: t.id, checklist: next });
                            }}
                          />
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      {t.status === "DIRTY" && (
                        <Button size="sm" variant="secondary" loading={patchTask.isPending} onClick={() => patchTask.mutate({ mode: "update", taskId: t.id, status: "IN_PROGRESS" })}>
                          <Play className="size-3.5" /> Start Cleaning
                        </Button>
                      )}
                      {(t.status === "DIRTY" || t.status === "IN_PROGRESS") && (
                        <Button size="sm" loading={patchTask.isPending} onClick={() => patchTask.mutate({ mode: "update", taskId: t.id, status: "CLEAN" })}>
                          <CheckCircle2 className="size-3.5" /> Mark Clean
                        </Button>
                      )}
                      {t.status === "CLEAN" && hk.data.canInspect && (
                        <>
                          <Button size="sm" loading={patchTask.isPending} onClick={() => patchTask.mutate({ mode: "inspect", taskId: t.id, approved: true })}>
                            <ClipboardCheck className="size-3.5" /> Approve Inspection &amp; Release Cabana
                          </Button>
                          <Button size="sm" variant="danger" loading={patchTask.isPending} onClick={() => patchTask.mutate({ mode: "inspect", taskId: t.id, approved: false, notes: "Re-clean required" })}>
                            <RotateCcw className="size-3.5" /> Reject (Back to Dirty)
                          </Button>
                        </>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "maintenance" && (
        <div className="space-y-5">
          <Card className="space-y-3 p-5">
            <h3 className="font-semibold">Log Maintenance / Repair Request</h3>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Cabana (optional)">
                <Select value={mCabanaId} onChange={(e) => setMCabanaId(e.target.value)}>
                  <option value="">General Resort / Facility</option>
                  {hk.data?.cabanas.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </Select>
              </Field>
              <Field label="Issue title *"><Input placeholder="AC compressor / Plunge pool pump" value={mTitle} onChange={(e) => setMTitle(e.target.value)} /></Field>
              <Field label="Priority">
                <Select value={mPrio} onChange={(e) => setMPrio(e.target.value as typeof mPrio)}>
                  {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}
                </Select>
              </Field>
              <Field label="Details"><Input placeholder="Symptoms / parts needed" value={mDesc} onChange={(e) => setMDesc(e.target.value)} /></Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Checkbox label="Immediately place cabana into MAINTENANCE operational status (blocks bookings)" checked={mLock} onChange={(e) => setMLock(e.target.checked)} />
              <Button disabled={mTitle.trim().length < 2} loading={createMaint.isPending} onClick={() => createMaint.mutate()}>
                <Plus className="size-4" /> Submit Request
              </Button>
            </div>
          </Card>

          {maint.data?.requests.length === 0 ? (
            <EmptyState title="No maintenance requests" text="All cabanas and resort equipment are operating normally." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {maint.data?.requests.map((r) => (
                <Card key={r.id} className="space-y-3 p-5 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-muted">{r.cabana ? `${r.cabana.code} · ${r.cabana.name}` : "General Facility"}</p>
                      <h4 className="font-semibold">{r.title}</h4>
                      {r.description && <p className="mt-1 text-xs text-muted">{r.description}</p>}
                    </div>
                    <div className="flex gap-1.5">
                      <Badge tone={PRIO_TONE[r.priority]}>{r.priority}</Badge>
                      <Badge tone={r.status === "APPROVED" ? "green" : r.status === "COMPLETED" ? "blue" : "amber"}>{r.status}</Badge>
                    </div>
                  </div>

                  {r.cost && <p className="text-xs">Repair cost: <b>{money(r.cost, currency)}</b></p>}

                  {!["APPROVED", "CANCELLED"].includes(r.status) && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      {r.status === "OPEN" && (
                        <Button size="sm" variant="secondary" onClick={() => patchMaint.mutate({ id: r.id, status: "IN_PROGRESS" })}>
                          Start Repair
                        </Button>
                      )}
                      {r.status !== "COMPLETED" && (
                        <>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder={`Cost (${currency})`}
                            value={mCostMap[r.id] ?? ""}
                            onChange={(e) => setMCostMap((m) => ({ ...m, [r.id]: e.target.value }))}
                            className="h-8 w-32 text-xs"
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => patchMaint.mutate({ id: r.id, status: "COMPLETED", cost: mCostMap[r.id] ? Number(mCostMap[r.id]) : undefined })}
                          >
                            Mark Completed
                          </Button>
                        </>
                      )}
                      <Button size="sm" onClick={() => patchMaint.mutate({ id: r.id, status: "APPROVED", cost: mCostMap[r.id] ? Number(mCostMap[r.id]) : undefined })}>
                        Approve &amp; Restore Cabana
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "lostfound" && hk.data && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Item description *" className="min-w-64 flex-1"><Input placeholder="Gold watch / AirPods case" value={lfDesc} onChange={(e) => setLfDesc(e.target.value)} /></Field>
            <Field label="Found location / Cabana"><Input placeholder="Cabana C-02 bedside" value={lfWhere} onChange={(e) => setLfWhere(e.target.value)} /></Field>
            <Button disabled={lfDesc.trim().length < 2} loading={createLf.isPending} onClick={() => createLf.mutate()}><Plus className="size-4" /> Log Item</Button>
          </div>
          {hk.data.lostFound.length === 0 ? (
            <p className="text-sm text-muted">No lost &amp; found items logged.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {hk.data.lostFound.map((item) => (
                <li key={item.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium">{item.description}</p>
                    <p className="text-xs text-muted">{item.foundAt || "Resort"} · Logged {new Date(item.createdAt).toLocaleDateString()}</p>
                  </div>
                  {item.claimedAt ? (
                    <Badge tone="green">Claimed {new Date(item.claimedAt).toLocaleDateString()}</Badge>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => claimLf.mutate(item.id)}>Mark Claimed</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

