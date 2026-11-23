"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  BarChart3, Bell, CheckCircle2, Download, FileSpreadsheet, FileText, Printer, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { PropertySelect, useProperties, usePropertySelection } from "@/components/property-select";
import { api, money } from "@/lib/utils";

const COLORS = ["#0D9488", "#0E132E", "#0284C7", "#D97706", "#7C3AED", "#DC2626"];

interface ReportsPayload {
  kpis: {
    totalCabanas: number;
    availableCabanas: number;
    occupiedCabanas: number;
    periodBookings: number;
    periodRevenue: string;
    periodExpenses: string;
    netProfit: string;
    occupancyRate: number;
    outstandingPayments: string;
  };
  charts: {
    revenueTrends: { date: string; revenue: number; bookings: number }[];
    cabanaPerformance: { code: string; name: string; bookings: number; revenue: number; occupiedHours: number; occupancyRate: number }[];
    bookingSources: { source: string; count: number; revenue: number }[];
    paymentMethods: { method: string; amount: number; count: number }[];
    expenseAnalysis: { category: string; amount: number }[];
  };
  tables: Record<string, Record<string, string | number>[]>;
}

interface NotificationRow {
  id: string; channel: "IN_APP" | "EMAIL" | "SMS" | "WHATSAPP"; event: string;
  subject: string | null; body: string; status: string; createdAt: string; readAt: string | null;
}
interface TemplateRow {
  id: string; event: string; channel: string; subject: string | null; body: string;
}

function downloadDelimited(filename: string, rows: Record<string, string | number>[], sep = ",") {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(sep), ...rows.map((r) => headers.map((h) => escape(r[h])).join(sep))];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: sep === "\t" ? "application/vnd.ms-excel;charset=utf-8;" : "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsClient() {
  const qc = useQueryClient();
  const props = useProperties();
  const [pid, setPid] = usePropertySelection(props.data);
  const [tab, setTab] = useState<"analytics" | "exports" | "notifications">("analytics");
  const [reportKey, setReportKey] = useState<"bookings" | "expenses" | "payments" | "refunds" | "restaurant" | "staff">("bookings");
  const [from, setFrom] = useState(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const currency = props.data?.find((p) => p.id === pid)?.currency ?? "LKR";

  const reports = useQuery({
    enabled: !!pid,
    queryKey: ["reports", pid, from, to],
    queryFn: async () =>
      (await api<ReportsPayload>(
        `/api/reports?propertyId=${pid}&from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`,
      )).data,
  });

  const comms = useQuery({
    enabled: tab === "notifications",
    queryKey: ["notifications"],
    queryFn: async () =>
      (await api<{ notifications: NotificationRow[]; templates: TemplateRow[]; events: string[] }>("/api/notifications")).data,
  });

  // Notification template & test dispatch
  const [nEvent, setNEvent] = useState("BOOKING_CONFIRMATION");
  const [nChannel, setNChannel] = useState<"IN_APP" | "EMAIL" | "SMS" | "WHATSAPP">("WHATSAPP");
  const [nSubj, setNSubj] = useState("Booking Confirmed · {{reference}}");
  const [nBody, setNBody] = useState("Ayubowan {{guestName}}, your cabana reservation {{reference}} at {{propertyName}} is confirmed!");
  const [chInApp, setChInApp] = useState(true);
  const [chEmail, setChEmail] = useState(true);
  const [chSms, setChSms] = useState(false);
  const [chWa, setChWa] = useState(true);

  const saveTpl = useMutation({
    mutationFn: () =>
      api("/api/notifications", {
        method: "POST",
        body: { action: "template", event: nEvent, channel: nChannel, subject: nSubj, body: nBody },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const dispatch = useMutation({
    mutationFn: () => {
      const channels: ("IN_APP" | "EMAIL" | "SMS" | "WHATSAPP")[] = [];
      if (chInApp) channels.push("IN_APP");
      if (chEmail) channels.push("EMAIL");
      if (chSms) channels.push("SMS");
      if (chWa) channels.push("WHATSAPP");
      return api("/api/notifications", {
        method: "POST",
        body: {
          action: "dispatch",
          event: nEvent,
          channels,
          variables: {
            reference: "CP-DEMO-01",
            guestName: "Valued Guest",
            propertyName: props.data?.find((p) => p.id === pid)?.name ?? "CabanaPro Resort",
            amount: `${currency} 15,000.00`,
            cabanaCode: "C-01",
            title: "Routine AC Service",
            expiryDate: to,
          },
        },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api("/api/notifications", { method: "POST", body: { action: "mark_read", id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const activeRows = reports.data?.tables[reportKey] ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports, Analytics &amp; Notifications</h1>
          <p className="text-sm text-muted">Interactive Recharts analytics, CSV/Excel/PDF exports and multi-channel Email/SMS/WhatsApp alerts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.data && <PropertySelect props={props.data} value={pid} onChange={setPid} />}
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-38" />
          <span className="text-xs text-muted">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-38" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {([
          { k: "analytics", label: "Visual Analytics & Charts", icon: BarChart3 },
          { k: "exports", label: "Tabular Reports & Exports", icon: FileSpreadsheet },
          { k: "notifications", label: "Notifications (Email / SMS / WhatsApp)", icon: Bell },
        ] as const).map((t) => (
          <button
            key={t.k} onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t.k ? "bg-teal text-white" : "text-muted hover:bg-surface-2"}`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {reports.error && <ErrorState message={(reports.error as Error).message} onRetry={() => reports.refetch()} />}
      {reports.isLoading && <Skeleton className="h-72" />}

      {tab === "analytics" && reports.data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5">
              <p className="text-xs text-muted">Period Revenue</p>
              <p className="mt-1 text-2xl font-semibold text-teal">{money(reports.data.kpis.periodRevenue, currency)}</p>
              <p className="mt-1 text-xs text-muted">{reports.data.kpis.periodBookings} confirmed booking(s)</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-muted">Net Profit</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-600">{money(reports.data.kpis.netProfit, currency)}</p>
              <p className="mt-1 text-xs text-muted">Expenses: {money(reports.data.kpis.periodExpenses, currency)}</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-muted">Average Occupancy Rate</p>
              <p className="mt-1 text-2xl font-semibold">{reports.data.kpis.occupancyRate}%</p>
              <p className="mt-1 text-xs text-muted">{reports.data.kpis.availableCabanas} available / {reports.data.kpis.totalCabanas} total</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-muted">Outstanding Payments</p>
              <p className="mt-1 text-2xl font-semibold text-amber-600">{money(reports.data.kpis.outstandingPayments, currency)}</p>
              <p className="mt-1 text-xs text-muted">Unpaid folio balances</p>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-3 font-semibold">Revenue &amp; Booking Trends</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={reports.data.charts.revenueTrends}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" name={`Revenue (${currency})`} stroke="#0D9488" strokeWidth={2.5} />
                    <Line type="monotone" dataKey="bookings" name="Bookings" stroke="#0284C7" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="mb-3 font-semibold">Cabana Performance &amp; Occupancy %</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reports.data.charts.cabanaPerformance}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="code" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="revenue" name={`Revenue (${currency})`} fill="#0D9488" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="occupancyRate" name="Occupancy %" fill="#0E132E" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="mb-3 font-semibold">Booking Source Breakdown</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={reports.data.charts.bookingSources} dataKey="revenue" nameKey="source" outerRadius={85} label>
                      {reports.data.charts.bookingSources.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="mb-3 font-semibold">Payment Methods &amp; Expense Categories</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reports.data.charts.paymentMethods}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="method" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="amount" name={`Collected (${currency})`} fill="#0284C7" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "exports" && reports.data && (
        <div className="space-y-4">
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex flex-wrap gap-2">
              {([
                { k: "bookings", label: "Bookings & Occupancy Report" },
                { k: "payments", label: "Payments Report" },
                { k: "refunds", label: "Refunds Report" },
                { k: "expenses", label: "Expenses Report" },
                { k: "restaurant", label: "Restaurant POS Report" },
                { k: "staff", label: "Staff & Attendance Report" },
              ] as const).map((r) => (
                <button
                  key={r.k}
                  onClick={() => setReportKey(r.k)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium ${reportKey === r.k ? "bg-navy text-white" : "bg-surface-2 text-muted hover:text-foreground"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={!activeRows.length} onClick={() => downloadDelimited(`cabanapro-${reportKey}-${from}.csv`, activeRows, ",")}>
                <Download className="size-3.5" /> Export CSV
              </Button>
              <Button size="sm" variant="secondary" disabled={!activeRows.length} onClick={() => downloadDelimited(`cabanapro-${reportKey}-${from}.xls`, activeRows, "\t")}>
                <FileSpreadsheet className="size-3.5" /> Export Excel
              </Button>
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                <Printer className="size-3.5" /> Print / Save PDF
              </Button>
            </div>
          </Card>

          {activeRows.length === 0 ? (
            <EmptyState title="No records in selected period" text="Widen the date range above to populate this report." />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="border-b border-border text-left text-muted">
                  <tr>
                    {Object.keys(activeRows[0]).map((h) => (
                      <th key={h} className="px-4 py-3 font-medium uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeRows.map((row, idx) => (
                    <tr key={idx} className="border-b border-border last:border-0">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-4 py-2.5">{String(val)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {tab === "notifications" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4 p-5">
            <h3 className="font-semibold">Notification Templates &amp; Test Trigger</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Trigger Event">
                <Select value={nEvent} onChange={(e) => setNEvent(e.target.value)}>
                  {(comms.data?.events ?? ["BOOKING_CONFIRMATION", "NEW_BOOKING", "PAYMENT_SUCCESS", "CLEANING_TASK_ASSIGNED", "SUBSCRIPTION_EXPIRY"]).map((ev) => (
                    <option key={ev} value={ev}>{ev}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Template Channel">
                <Select value={nChannel} onChange={(e) => setNChannel(e.target.value as typeof nChannel)}>
                  <option value="IN_APP">In-App Notification</option>
                  <option value="EMAIL">Email</option>
                  <option value="WHATSAPP">WhatsApp Business</option>
                  <option value="SMS">SMS Provider</option>
                </Select>
              </Field>
            </div>
            <Field label="Subject"><Input value={nSubj} onChange={(e) => setNSubj(e.target.value)} /></Field>
            <Field label="Message Template ({{reference}}, {{guestName}}, {{propertyName}}, {{amount}})">
              <Textarea value={nBody} onChange={(e) => setNBody(e.target.value)} />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="secondary" loading={saveTpl.isPending} onClick={() => saveTpl.mutate()}>
                <FileText className="size-4" /> Save Template
              </Button>
              <div className="flex flex-wrap items-center gap-3">
                <Checkbox label="In-App" checked={chInApp} onChange={(e) => setChInApp(e.target.checked)} />
                <Checkbox label="Email" checked={chEmail} onChange={(e) => setChEmail(e.target.checked)} />
                <Checkbox label="SMS" checked={chSms} onChange={(e) => setChSms(e.target.checked)} />
                <Checkbox label="WhatsApp" checked={chWa} onChange={(e) => setChWa(e.target.checked)} />
                <Button loading={dispatch.isPending} onClick={() => dispatch.mutate()}>
                  <Send className="size-4" /> Send Test Alert
                </Button>
              </div>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <h3 className="font-semibold">Delivery History ({comms.data?.notifications.length ?? 0})</h3>
            {comms.data?.notifications.length === 0 ? (
              <p className="text-sm text-muted">No notifications dispatched yet.</p>
            ) : (
              <ul className="max-h-[460px] divide-y divide-border overflow-y-auto rounded-xl border border-border text-xs">
                {comms.data?.notifications.map((n) => (
                  <li key={n.id} className="space-y-1 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Badge tone="blue">{n.channel}</Badge>
                        <span className="font-semibold">{n.event}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={n.status === "READ" ? "gray" : "green"}>{n.status}</Badge>
                        {n.status !== "READ" && (
                          <button onClick={() => markRead.mutate(n.id)} className="text-teal hover:underline">
                            <CheckCircle2 className="inline size-3.5" /> Read
                          </button>
                        )}
                      </div>
                    </div>
                    {n.subject && <p className="font-medium">{n.subject}</p>}
                    <p className="text-muted">{n.body}</p>
                    <p className="text-[11px] text-muted">{new Date(n.createdAt).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

