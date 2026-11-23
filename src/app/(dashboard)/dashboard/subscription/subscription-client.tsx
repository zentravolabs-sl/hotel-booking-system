"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CreditCard, KeyRound, Plus, Printer, Shield, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, ErrorState, Skeleton } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { api, ApiError, money } from "@/lib/utils";

interface PlanRow {
  id: string; code: string; name: string; priceMonthly: string; priceYearly: string;
  maxProperties: number; maxCabanas: number; maxUsers: number;
}
interface SubInvoiceRow { id: string; number: string; amount: string; currency: string; paidAt: string | null; dueAt: string }
interface SubOverview {
  organization: { id: string; name: string; slug: string; status: string; currency: string; onboardingDone: boolean };
  subscription: {
    id: string; status: string; interval: "MONTHLY" | "YEARLY"; currentPeriodStart: string; currentPeriodEnd: string;
    plan: PlanRow; invoices: SubInvoiceRow[];
  } | null;
  plans: PlanRow[];
  usage: {
    properties: { used: number; max: number };
    cabanas: { used: number; max: number };
    users: { used: number; max: number };
  };
  daysRemaining: number;
  expiryAlert: string | null;
}

interface TeamFeed {
  users: {
    id: string; name: string; email: string; phone: string | null; status: "PENDING" | "ACTIVE" | "SUSPENDED";
    lastLoginAt: string | null;
    role: { id: string; key: string; name: string };
    properties: { property: { id: string; name: string } }[];
  }[];
  roles: { id: string; key: string; name: string; description: string | null; isSystem: boolean; permissions: { permission: { key: string; label: string } }[] }[];
  properties: { id: string; name: string }[];
  permissionCatalog: { key: string; label: string }[];
}

export function SubscriptionClient() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"billing" | "users" | "roles">("billing");
  const [interval, setInterval] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [subErr, setSubErr] = useState<string | null>(null);

  const sub = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => (await api<SubOverview>("/api/subscription")).data,
  });

  const team = useQuery({
    enabled: tab !== "billing",
    queryKey: ["users_roles"],
    queryFn: async () => (await api<TeamFeed>("/api/users")).data,
  });

  const switchPlan = useMutation({
    mutationFn: (planCode: string) =>
      api("/api/subscription", { method: "POST", body: { planCode, interval } }),
    onSuccess: () => { setSubErr(null); qc.invalidateQueries({ queryKey: ["subscription"] }); },
    onError: (e) => setSubErr(e instanceof ApiError ? e.message : "Could not change plan"),
  });

  // User invite form
  const [uName, setUName] = useState("");
  const [uEmail, setUEmail] = useState("");
  const [uPass, setUPass] = useState("");
  const [uRole, setURole] = useState("");
  const [uProps, setUProps] = useState<string[]>([]);
  const [uErr, setUErr] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () =>
      api("/api/users", {
        method: "POST",
        body: {
          action: "invite_user",
          name: uName,
          email: uEmail,
          password: uPass,
          roleId: uRole || team.data?.roles[0]?.id,
          propertyIds: uProps,
        },
      }),
    onSuccess: () => {
      setUName(""); setUEmail(""); setUPass(""); setUErr(null);
      qc.invalidateQueries({ queryKey: ["users_roles"] });
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (e) => setUErr(e instanceof ApiError ? e.message : "Could not invite user"),
  });

  const setStatus = useMutation({
    mutationFn: (p: { userId: string; status: "ACTIVE" | "SUSPENDED" }) =>
      api("/api/users", { method: "POST", body: { action: "set_status", ...p } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users_roles"] }),
  });

  // Custom role form
  const [rName, setRName] = useState("");
  const [rDesc, setRDesc] = useState("");
  const [rPerms, setRPerms] = useState<string[]>(["booking:read", "cabana:read"]);
  const createRole = useMutation({
    mutationFn: () =>
      api("/api/users", {
        method: "POST",
        body: { action: "custom_role", name: rName, description: rDesc || undefined, permissions: rPerms },
      }),
    onSuccess: () => { setRName(""); setRDesc(""); qc.invalidateQueries({ queryKey: ["users_roles"] }); },
  });

  const currency = sub.data?.organization.currency ?? "LKR";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Subscription, Team &amp; Role Permissions</h1>
          <p className="text-sm text-muted">Manage your SaaS plan, resource limits, subscription invoices, user invitations and custom RBAC roles.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {([
          { k: "billing", label: "Plan, Usage & Invoices", icon: CreditCard },
          { k: "users", label: "Users & Invitations", icon: UserPlus },
          { k: "roles", label: "Roles & Granular Permissions", icon: KeyRound },
        ] as const).map((t) => (
          <button
            key={t.k} onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t.k ? "bg-teal text-white" : "text-muted hover:bg-surface-2"}`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {sub.error && <ErrorState message={(sub.error as Error).message} onRetry={() => sub.refetch()} />}
      {sub.isLoading && <Skeleton className="h-64" />}

      {tab === "billing" && sub.data && (
        <div className="space-y-6">
          {sub.data.expiryAlert && (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="size-5 shrink-0" />
              <span>{sub.data.expiryAlert}</span>
            </div>
          )}

          {subErr && <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-danger">{subErr}</p>}

          <div className="grid gap-4 sm:grid-cols-3">
            {(["properties", "cabanas", "users"] as const).map((k) => {
              const u = sub.data.usage[k];
              const pct = Math.min(100, Math.round((u.used / u.max) * 100));
              return (
                <Card key={k} className="space-y-2 p-5">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium capitalize">{k} usage</span>
                    <span className="font-semibold">{u.used} / {u.max}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className={`h-full ${pct >= 90 ? "bg-amber-500" : "bg-teal"}`} style={{ width: `${pct}%` }} />
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Available SaaS Plans</h2>
            <div className="inline-flex rounded-xl border border-border bg-surface p-1 text-xs">
              <button onClick={() => setInterval("MONTHLY")} className={`rounded-lg px-3 py-1.5 font-medium ${interval === "MONTHLY" ? "bg-teal text-white" : "text-muted"}`}>Monthly</button>
              <button onClick={() => setInterval("YEARLY")} className={`rounded-lg px-3 py-1.5 font-medium ${interval === "YEARLY" ? "bg-teal text-white" : "text-muted"}`}>Yearly (Save 2 months)</button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {sub.data.plans.map((p) => {
              const isCurrent = sub.data.subscription?.plan.id === p.id;
              const price = interval === "YEARLY" ? p.priceYearly : p.priceMonthly;
              return (
                <Card key={p.id} className={`flex flex-col justify-between p-6 ${isCurrent ? "border-2 border-teal" : ""}`}>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{p.name}</h3>
                      {isCurrent && <Badge tone="green">{sub.data.subscription?.status}</Badge>}
                    </div>
                    <p className="text-2xl font-bold text-teal">
                      {money(price, currency)} <span className="text-xs font-normal text-muted">/ {interval === "YEARLY" ? "year" : "month"}</span>
                    </p>
                    <ul className="space-y-1.5 text-xs text-muted">
                      <li className="flex items-center gap-1.5"><Check className="size-4 text-teal" /> Up to {p.maxProperties} property / branch(es)</li>
                      <li className="flex items-center gap-1.5"><Check className="size-4 text-teal" /> Up to {p.maxCabanas} cabanas</li>
                      <li className="flex items-center gap-1.5"><Check className="size-4 text-teal" /> Up to {p.maxUsers} staff accounts</li>
                    </ul>
                  </div>
                  <Button
                    className="mt-6 w-full"
                    variant={isCurrent ? "secondary" : "primary"}
                    loading={switchPlan.isPending}
                    onClick={() => switchPlan.mutate(p.code)}
                  >
                    {isCurrent ? `Renew (${interval})` : `Switch to ${p.name}`}
                  </Button>
                </Card>
              );
            })}
          </div>

          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Subscription Invoices</h3>
            {!sub.data.subscription?.invoices.length ? (
              <p className="text-sm text-muted">No subscription invoices issued yet (currently in trial).</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-muted">
                  <tr>
                    {["Invoice #", "Amount", "Paid On", ""].map((h) => <th key={h} className="py-2 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {sub.data.subscription.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border last:border-0">
                      <td className="py-2.5 font-mono text-xs font-semibold">{inv.number}</td>
                      <td className="py-2.5 font-semibold">{money(inv.amount, inv.currency)}</td>
                      <td className="py-2.5 text-xs text-muted">{inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : "Unpaid"}</td>
                      <td className="py-2.5 text-right">
                        <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer className="size-3.5" /> Print</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {tab === "users" && team.data && (
        <div className="space-y-5">
          <Card className="space-y-4 p-5">
            <h3 className="font-semibold">Invite / Create Staff User Account</h3>
            {uErr && <p className="text-xs text-danger">{uErr}</p>}
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Full name *"><Input value={uName} onChange={(e) => setUName(e.target.value)} /></Field>
              <Field label="Email *"><Input type="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} /></Field>
              <Field label="Temporary password *"><Input type="password" value={uPass} onChange={(e) => setUPass(e.target.value)} /></Field>
              <Field label="Role">
                <Select value={uRole || team.data.roles[0]?.id || ""} onChange={(e) => setURole(e.target.value)}>
                  {team.data.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-3">
                {team.data.properties.map((p) => (
                  <Checkbox
                    key={p.id}
                    label={`Access: ${p.name}`}
                    checked={uProps.includes(p.id)}
                    onChange={(e) =>
                      setUProps((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))
                    }
                  />
                ))}
              </div>
              <Button disabled={uName.trim().length < 2 || !uEmail || uPass.length < 8} loading={invite.isPending} onClick={() => invite.mutate()}>
                <Plus className="size-4" /> Add User
              </Button>
            </div>
          </Card>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="border-b border-border text-left text-muted">
                <tr>
                  {["Name", "Email", "Role", "Assigned Properties", "Status", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {team.data.users.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-xs text-muted">{u.email}</td>
                    <td className="px-4 py-3"><Badge tone="blue">{u.role.name}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {u.properties.map((p) => p.property.name).join(", ") || "All org properties"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.status === "ACTIVE" ? "green" : "red"}>{u.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.status === "ACTIVE" ? (
                        <Button size="sm" variant="danger" onClick={() => setStatus.mutate({ userId: u.id, status: "SUSPENDED" })}>Suspend</Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => setStatus.mutate({ userId: u.id, status: "ACTIVE" })}>Activate</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "roles" && team.data && (
        <div className="space-y-5">
          <Card className="space-y-4 p-5">
            <h3 className="font-semibold">Create Custom Role with Granular Permissions</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Custom role name *"><Input placeholder="Night Auditor / Pool Supervisor" value={rName} onChange={(e) => setRName(e.target.value)} /></Field>
              <Field label="Description"><Input value={rDesc} onChange={(e) => setRDesc(e.target.value)} /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {team.data.permissionCatalog.map((p) => (
                <Checkbox
                  key={p.key}
                  label={`${p.key} (${p.label})`}
                  checked={rPerms.includes(p.key)}
                  onChange={(e) =>
                    setRPerms((cur) => (e.target.checked ? [...cur, p.key] : cur.filter((x) => x !== p.key)))
                  }
                />
              ))}
            </div>
            <Button disabled={rName.trim().length < 2 || !rPerms.length} loading={createRole.isPending} onClick={() => createRole.mutate()}>
              <Shield className="size-4" /> Save Custom Role
            </Button>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {team.data.roles.map((r) => (
              <Card key={r.id} className="space-y-2 p-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{r.name}</span>
                  <Badge tone={r.isSystem ? "blue" : "purple"}>{r.isSystem ? "System Default" : "Custom Role"}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {r.permissions.map((p) => <Badge key={p.permission.key}>{p.permission.key}</Badge>)}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

