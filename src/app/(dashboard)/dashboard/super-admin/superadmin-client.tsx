"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Ban, Building2, CheckCircle2, CreditCard, FileText, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, ErrorState, Skeleton } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { api, money } from "@/lib/utils";

interface SuperAdminPayload {
  metrics: {
    totalOrganizations: number;
    activeSubscriptions: number;
    trialAccounts: number;
    expiredSubscriptions: number;
    suspendedOrganizations: number;
    subscriptionRevenue: string;
    systemHealth: string;
  };
  organizations: {
    id: string; name: string; slug: string; status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
    email: string | null; suspendedReason: string | null; createdAt: string;
    subscriptions: { status: string; plan: { code: string; name: string; priceMonthly: string } }[];
    _count: { properties: number; users: number };
  }[];
  plans: {
    id: string; code: string; name: string; priceMonthly: string; priceYearly: string;
    maxProperties: number; maxCabanas: number; maxUsers: number;
  }[];
  invoices: {
    id: string; number: string; amount: string; currency: string; paidAt: string | null; createdAt: string;
    subscription: { organization: { name: string }; plan: { name: string } };
  }[];
  auditLogs: {
    id: string; organizationId: string | null; userId: string | null; action: string; entity: string; entityId: string | null; createdAt: string;
  }[];
}

export function SuperAdminClient() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"tenants" | "plans" | "invoices" | "audit">("tenants");

  const feed = useQuery({
    queryKey: ["super_admin"],
    queryFn: async () => (await api<SuperAdminPayload>("/api/super-admin")).data,
  });

  const setOrgStatus = useMutation({
    mutationFn: (p: { organizationId: string; status: "ACTIVE" | "SUSPENDED" }) =>
      api("/api/super-admin", { method: "POST", body: { action: "org_status", ...p } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super_admin"] }),
  });

  // Plan editor
  const [pCode, setPCode] = useState("");
  const [pName, setPName] = useState("");
  const [pMonth, setPMonth] = useState("9900");
  const [pYear, setPYear] = useState("99000");
  const [pProps, setPProps] = useState("5");
  const [pCabs, setPCabs] = useState("50");
  const [pUsers, setPUsers] = useState("30");

  const upsertPlan = useMutation({
    mutationFn: () =>
      api("/api/super-admin", {
        method: "POST",
        body: {
          action: "upsert_plan",
          code: pCode,
          name: pName,
          priceMonthly: Number(pMonth),
          priceYearly: Number(pYear),
          maxProperties: Number(pProps),
          maxCabanas: Number(pCabs),
          maxUsers: Number(pUsers),
        },
      }),
    onSuccess: () => { setPCode(""); setPName(""); qc.invalidateQueries({ queryKey: ["super_admin"] }); },
  });

  const m = feed.data?.metrics;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Super Admin Platform Console</h1>
          <p className="text-sm text-muted">SaaS tenant management, subscription plans, platform revenue, system health and global audit trails.</p>
        </div>
        {m && (
          <Badge tone="green"><Activity className="mr-1 size-3.5" />System Health: {m.systemHealth}</Badge>
        )}
      </div>

      {feed.error && <ErrorState message={(feed.error as Error).message} onRetry={() => feed.refetch()} />}
      {feed.isLoading && <Skeleton className="h-64" />}

      {m && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Card className="p-4"><p className="text-xs text-muted">Total Organizations</p><p className="mt-1 text-2xl font-semibold">{m.totalOrganizations}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted">Active Subscriptions</p><p className="mt-1 text-2xl font-semibold text-emerald-600">{m.activeSubscriptions}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted">Trial Accounts</p><p className="mt-1 text-2xl font-semibold text-sky-600">{m.trialAccounts}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted">Suspended / Expired</p><p className="mt-1 text-2xl font-semibold text-danger">{m.suspendedOrganizations + m.expiredSubscriptions}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted">SaaS Revenue</p><p className="mt-1 text-2xl font-semibold text-teal">{money(m.subscriptionRevenue)}</p></Card>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {([
          { k: "tenants", label: "Organizations & Tenants", icon: Building2 },
          { k: "plans", label: "SaaS Plan Catalog", icon: ShieldCheck },
          { k: "invoices", label: "Subscription Revenue History", icon: CreditCard },
          { k: "audit", label: "Platform Audit Logs", icon: FileText },
        ] as const).map((t) => (
          <button
            key={t.k} onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t.k ? "bg-teal text-white" : "text-muted hover:bg-surface-2"}`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "tenants" && feed.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                {["Organization", "Slug", "Plan", "Properties", "Users", "Status", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {feed.data.organizations.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{o.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{o.slug}</td>
                  <td className="px-4 py-3">{o.subscriptions[0]?.plan.name ?? "Trial"}</td>
                  <td className="px-4 py-3">{o._count.properties}</td>
                  <td className="px-4 py-3">{o._count.users}</td>
                  <td className="px-4 py-3">
                    <Badge tone={o.status === "ACTIVE" ? "green" : o.status === "SUSPENDED" ? "red" : "amber"}>{o.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {o.status !== "SUSPENDED" ? (
                      <Button size="sm" variant="danger" onClick={() => setOrgStatus.mutate({ organizationId: o.id, status: "SUSPENDED" })}>
                        <Ban className="size-3.5" /> Suspend Tenant
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setOrgStatus.mutate({ organizationId: o.id, status: "ACTIVE" })}>
                        <CheckCircle2 className="size-3.5" /> Reactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "plans" && feed.data && (
        <div className="space-y-5">
          <Card className="space-y-3 p-5">
            <h3 className="font-semibold">Create or Update SaaS Plan</h3>
            <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <Field label="Code *"><Input placeholder="pro" value={pCode} onChange={(e) => setPCode(e.target.value)} /></Field>
              <Field label="Name *"><Input placeholder="Resort Pro" value={pName} onChange={(e) => setPName(e.target.value)} /></Field>
              <Field label="Monthly (LKR)"><Input type="number" value={pMonth} onChange={(e) => setPMonth(e.target.value)} /></Field>
              <Field label="Yearly (LKR)"><Input type="number" value={pYear} onChange={(e) => setPYear(e.target.value)} /></Field>
              <Field label="Max Props"><Input type="number" value={pProps} onChange={(e) => setPProps(e.target.value)} /></Field>
              <Field label="Max Cabanas"><Input type="number" value={pCabs} onChange={(e) => setPCabs(e.target.value)} /></Field>
              <Field label="Max Users"><Input type="number" value={pUsers} onChange={(e) => setPUsers(e.target.value)} /></Field>
            </div>
            <Button disabled={!pCode.trim() || !pName.trim()} loading={upsertPlan.isPending} onClick={() => upsertPlan.mutate()}>
              <Plus className="size-4" /> Save Plan
            </Button>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            {feed.data.plans.map((p) => (
              <Card key={p.id} className="space-y-2 p-5 text-sm">
                <div className="flex justify-between">
                  <span className="font-semibold">{p.name}</span>
                  <span className="font-mono text-xs text-muted">{p.code}</span>
                </div>
                <p className="text-lg font-bold text-teal">{money(p.priceMonthly)} / mo</p>
                <p className="text-xs text-muted">Limits: {p.maxProperties} props · {p.maxCabanas} cabanas · {p.maxUsers} users</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === "invoices" && feed.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                {["Invoice #", "Organization", "Plan", "Amount", "Paid Date"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {feed.data.invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs font-semibold">{inv.number}</td>
                  <td className="px-4 py-3 font-medium">{inv.subscription.organization.name}</td>
                  <td className="px-4 py-3">{inv.subscription.plan.name}</td>
                  <td className="px-4 py-3 font-semibold">{money(inv.amount, inv.currency)}</td>
                  <td className="px-4 py-3 text-xs text-muted">{inv.paidAt ? new Date(inv.paidAt).toLocaleString() : "Pending"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "audit" && feed.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-xs">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                {["Timestamp", "Action", "Entity", "Entity ID", "Organization ID"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {feed.data.auditLogs.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 text-muted">{new Date(a.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-mono font-semibold">{a.action}</td>
                  <td className="px-4 py-2.5">{a.entity}</td>
                  <td className="px-4 py-2.5 font-mono text-muted">{a.entityId ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-muted">{a.organizationId ?? "Platform"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

