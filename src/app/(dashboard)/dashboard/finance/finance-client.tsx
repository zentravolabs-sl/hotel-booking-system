"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft, Banknote, Calculator, FileSpreadsheet, Plus, Printer, Receipt,
  RotateCcw, Trash2, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { PropertySelect, useProperties, usePropertySelection } from "@/components/property-select";
import { api, ApiError, money } from "@/lib/utils";

interface FinancialSummary {
  bookingRevenue: string;
  extraServiceRevenue: string;
  restaurantRevenue: string;
  totalRevenue: string;
  taxSummary: string;
  serviceChargeSummary: string;
  totalExpenses: string;
  netProfit: string;
  outstandingReceivables: string;
  treasury: {
    grossPayments: string;
    totalRefunds: string;
    netCashCollected: string;
    byMethod: Record<string, string>;
  };
}
interface CashClosing {
  id: string; businessDate: string; expectedCash: string; countedCash: string; createdAt: string;
}
interface PaymentRow {
  id: string; bookingId: string | null; method: string; status: string; amount: string; currency: string;
  provider: string | null; providerRef: string | null; receiptNo: string | null; paidAt: string | null;
  booking: { id: string; reference: string; guest: { firstName: string; lastName: string } } | null;
  refunds: { id: string; amount: string; reason: string | null; status: string; createdAt: string }[];
}
interface ExpenseRow {
  id: string; description: string; amount: string; incurredOn: string; category: { id: string; name: string };
}
interface InvoiceRow {
  id: string; number: string; total: string; issuedAt: string;
  data: { reference?: string; guestName?: string; propertyName?: string; currency?: string } | null;
}

function RefundModal({ payment, currency, onClose }: { payment: PaymentRow | null; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const already = payment ? payment.refunds.reduce((a, r) => a + Number(r.amount), 0) : 0;
  const maxRefundable = payment ? Math.max(0, Number(payment.amount) - already) : 0;
  const [amount, setAmount] = useState(maxRefundable > 0 ? maxRefundable.toFixed(2) : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      api("/api/refunds", {
        method: "POST",
        body: { paymentId: payment!.id, amount: Number(amount), reason },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Refund failed"),
  });

  return (
    <Dialog open={!!payment} onClose={onClose} title={`Process Refund · ${payment?.receiptNo ?? ""}`}>
      {payment && (
        <div className="space-y-4 text-sm">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-danger dark:bg-red-950/40">{error}</p>}
          <div className="flex justify-between rounded-xl border border-border p-3">
            <span>Original: <b>{money(payment.amount, currency)}</b></span>
            <span>Refunded: <b>{money(already, currency)}</b></span>
            <span>Max refundable: <b className="text-teal">{money(maxRefundable, currency)}</b></span>
          </div>
          <Field label={`Refund amount (${currency})`}>
            <Input type="number" step="0.01" max={maxRefundable} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Reason *">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cancelled within free window / overcharge…" />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!Number(amount) || Number(amount) > maxRefundable || reason.trim().length < 2}
              loading={m.isPending}
              onClick={() => { setError(null); m.mutate(); }}
            >
              <RotateCcw className="size-4" /> Issue Refund
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function FinanceClient() {
  const qc = useQueryClient();
  const props = useProperties();
  const [pid, setPid] = usePropertySelection(props.data);
  const [tab, setTab] = useState<"pnl" | "payments" | "expenses" | "invoices" | "closing">("pnl");
  const [from, setFrom] = useState(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [refundTarget, setRefundTarget] = useState<PaymentRow | null>(null);

  const currency = props.data?.find((p) => p.id === pid)?.currency ?? "LKR";

  const finance = useQuery({
    enabled: !!pid,
    queryKey: ["finance", pid, from, to],
    queryFn: async () =>
      (await api<{ summary: FinancialSummary; closings: CashClosing[] }>(
        `/api/finance?propertyId=${pid}&from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`,
      )).data,
  });

  const payments = useQuery({
    enabled: !!pid && tab === "payments",
    queryKey: ["payments", pid],
    queryFn: async () => (await api<PaymentRow[]>(`/api/payments?propertyId=${pid}`)).data,
  });

  const expenses = useQuery({
    enabled: !!pid && tab === "expenses",
    queryKey: ["expenses", pid],
    queryFn: async () => (await api<{ categories: { id: string; name: string }[]; expenses: ExpenseRow[] }>(`/api/expenses?propertyId=${pid}`)).data,
  });

  const invoices = useQuery({
    enabled: tab === "invoices",
    queryKey: ["invoices"],
    queryFn: async () => (await api<InvoiceRow[]>("/api/invoices")).data,
  });

  // Expense form
  const [eCat, setECat] = useState("Utilities");
  const [eDesc, setEDesc] = useState("");
  const [eAmt, setEAmt] = useState("");
  const [eDate, setEDate] = useState(() => new Date().toISOString().slice(0, 10));
  const addExpense = useMutation({
    mutationFn: () =>
      api("/api/expenses", {
        method: "POST",
        body: { propertyId: pid, categoryName: eCat, description: eDesc, amount: Number(eAmt), incurredOn: eDate },
      }),
    onSuccess: () => {
      setEDesc(""); setEAmt("");
      qc.invalidateQueries({ queryKey: ["expenses", pid] });
      qc.invalidateQueries({ queryKey: ["finance"] });
    },
  });
  const delExpense = useMutation({
    mutationFn: (id: string) => api(`/api/expenses?id=${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses", pid] });
      qc.invalidateQueries({ queryKey: ["finance"] });
    },
  });

  // Cash register closing form
  const [cDate, setCDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cCounted, setCCounted] = useState("");
  const closeRegister = useMutation({
    mutationFn: () =>
      api("/api/finance", {
        method: "POST",
        body: { propertyId: pid, businessDate: cDate, countedCash: Number(cCounted) },
      }),
    onSuccess: () => {
      setCCounted("");
      qc.invalidateQueries({ queryKey: ["finance"] });
    },
  });

  const s = finance.data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Finance & Accounting</h1>
          <p className="text-sm text-muted">Accrued P&amp;L (no double-counted deposits), payment ledger, refunds, expenses and daily cash closing.</p>
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
          { k: "pnl", label: "Profit & Loss / Tax", icon: TrendingUp },
          { k: "payments", label: "Payments & Refunds", icon: Receipt },
          { k: "expenses", label: "Expenses", icon: TrendingDown },
          { k: "invoices", label: "Invoices", icon: FileSpreadsheet },
          { k: "closing", label: "Daily Cash Closing", icon: Calculator },
        ] as const).map((t) => (
          <button
            key={t.k} onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t.k ? "bg-teal text-white" : "text-muted hover:bg-surface-2"}`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {finance.error && <ErrorState message={(finance.error as Error).message} onRetry={() => finance.refetch()} />}
      {finance.isLoading && <Skeleton className="h-64" />}

      {tab === "pnl" && s && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5">
              <p className="text-xs text-muted">Accrued Total Revenue</p>
              <p className="mt-1 text-2xl font-semibold text-teal">{money(s.totalRevenue, currency)}</p>
              <p className="mt-1 text-xs text-muted">Bookings: {money(s.bookingRevenue, currency)} · POS: {money(s.restaurantRevenue, currency)}</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-muted">Total Expenses</p>
              <p className="mt-1 text-2xl font-semibold text-danger">{money(s.totalExpenses, currency)}</p>
              <p className="mt-1 text-xs text-muted">Logged operating costs</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-muted">Net Profit / (Loss)</p>
              <p className={`mt-1 text-2xl font-semibold ${Number(s.netProfit) >= 0 ? "text-emerald-600" : "text-danger"}`}>
                {money(s.netProfit, currency)}
              </p>
              <p className="mt-1 text-xs text-muted">Tax: {money(s.taxSummary, currency)} · Service: {money(s.serviceChargeSummary, currency)}</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-muted">Outstanding Balances</p>
              <p className="mt-1 text-2xl font-semibold text-amber-600">{money(s.outstandingReceivables, currency)}</p>
              <p className="mt-1 text-xs text-muted">Unpaid folio balances</p>
            </Card>
          </div>

          <Card className="p-5">
            <h2 className="font-semibold">Treasury & Cash Flow Reconciliation</h2>
            <p className="text-xs text-muted">
              Cash flow tracks actual advance payments, settlements and refunds received in the period, kept separate from accrued booking revenue so deposits and final settlements never double-count revenue.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs text-muted">Gross Payments Received</p>
                <p className="mt-1 text-lg font-semibold">{money(s.treasury.grossPayments, currency)}</p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs text-muted">Refunds Processed</p>
                <p className="mt-1 text-lg font-semibold text-danger">-{money(s.treasury.totalRefunds, currency)}</p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs text-muted">Net Cash Collected</p>
                <p className="mt-1 text-lg font-semibold text-emerald-600">{money(s.treasury.netCashCollected, currency)}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(s.treasury.byMethod).map(([m, val]) => (
                <div key={m} className="rounded-xl bg-surface-2/60 px-3 py-2 text-xs">
                  <span className="text-muted">{m}</span>
                  <p className="font-semibold">{money(val, currency)}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "payments" && (
        payments.isLoading ? (
          <Skeleton className="h-64" />
        ) : payments.data?.length === 0 ? (
          <EmptyState title="No payments recorded" text="Collect payments from the Front Desk or via PayHere online checkout." />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="border-b border-border text-left text-muted">
                <tr>
                  {["Receipt", "Booking / Guest", "Method", "Reference", "Amount", "Refunded", "Date", ""].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.data?.map((p) => {
                  const refunded = p.refunds.reduce((a, r) => a + Number(r.amount), 0);
                  return (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-mono text-xs font-semibold">{p.receiptNo || "—"}</td>
                      <td className="px-4 py-3">
                        {p.booking ? `${p.booking.reference} · ${p.booking.guest.firstName} ${p.booking.guest.lastName}` : "POS / Direct"}
                      </td>
                      <td className="px-4 py-3"><Badge tone="blue">{p.method}</Badge></td>
                      <td className="px-4 py-3 font-mono text-xs text-muted">{p.providerRef || "—"}</td>
                      <td className="px-4 py-3 font-semibold">{money(p.amount, currency)}</td>
                      <td className="px-4 py-3 text-danger">{refunded > 0 ? `-${money(refunded, currency)}` : "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted">{p.paidAt ? new Date(p.paidAt).toLocaleString() : "—"}</td>
                      <td className="px-4 py-3 text-right">
                        {refunded < Number(p.amount) && (
                          <Button size="sm" variant="secondary" onClick={() => setRefundTarget(p)}>
                            <RotateCcw className="size-3.5" /> Refund
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )
      )}

      {tab === "expenses" && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Category"><Input value={eCat} onChange={(e) => setECat(e.target.value)} placeholder="Utilities, Maintenance, F&B…" /></Field>
              <Field label="Description"><Input value={eDesc} onChange={(e) => setEDesc(e.target.value)} placeholder="Electricity bill / Pool chemicals" /></Field>
              <Field label={`Amount (${currency})`}><Input type="number" step="0.01" value={eAmt} onChange={(e) => setEAmt(e.target.value)} /></Field>
              <Field label="Date"><Input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} /></Field>
            </div>
            <div className="mt-3 flex justify-end">
              <Button disabled={!eCat.trim() || !eDesc.trim() || !Number(eAmt)} loading={addExpense.isPending} onClick={() => addExpense.mutate()}>
                <Plus className="size-4" /> Record Expense
              </Button>
            </div>
          </Card>

          {expenses.data?.expenses.length === 0 ? (
            <EmptyState title="No expenses recorded" text="Log operating expenses above to include them in P&L reports." />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-border text-left text-muted">
                  <tr>
                    {["Date", "Category", "Description", "Amount", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {expenses.data?.expenses.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-xs">{e.incurredOn.slice(0, 10)}</td>
                      <td className="px-4 py-3"><Badge>{e.category.name}</Badge></td>
                      <td className="px-4 py-3">{e.description}</td>
                      <td className="px-4 py-3 font-semibold text-danger">{money(e.amount, currency)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => delExpense.mutate(e.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {tab === "invoices" && (
        invoices.data?.length === 0 ? (
          <EmptyState title="No invoices issued" text="Invoices can be issued from booking folios." />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border text-left text-muted">
                <tr>
                  {["Invoice #", "Booking Ref", "Guest", "Total", "Issued", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {invoices.data?.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{inv.number}</td>
                    <td className="px-4 py-3 font-mono text-xs">{inv.data?.reference ?? "—"}</td>
                    <td className="px-4 py-3">{inv.data?.guestName ?? "—"}</td>
                    <td className="px-4 py-3 font-semibold">{money(inv.total, inv.data?.currency ?? currency)}</td>
                    <td className="px-4 py-3 text-xs text-muted">{new Date(inv.issuedAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer className="size-3.5" /> Print</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}

      {tab === "closing" && (
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="font-semibold">Close Daily Cash Register</h3>
            <p className="text-xs text-muted">System automatically calculates expected cash from the day&apos;s CASH payments minus CASH refunds and records any variance.</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="Business date"><Input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} /></Field>
              <Field label={`Counted drawer cash (${currency})`}><Input type="number" step="0.01" value={cCounted} onChange={(e) => setCCounted(e.target.value)} /></Field>
              <Button disabled={cCounted === ""} loading={closeRegister.isPending} onClick={() => closeRegister.mutate()}>
                <Calculator className="size-4" /> Reconcile & Close Day
              </Button>
            </div>
          </Card>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border text-left text-muted">
                <tr>
                  {["Business Date", "Expected Cash", "Counted Cash", "Variance", "Closed At"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {finance.data?.closings.map((c) => {
                  const diff = Number(c.countedCash) - Number(c.expectedCash);
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium">{c.businessDate.slice(0, 10)}</td>
                      <td className="px-4 py-3">{money(c.expectedCash, currency)}</td>
                      <td className="px-4 py-3 font-semibold">{money(c.countedCash, currency)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={diff === 0 ? "green" : diff > 0 ? "amber" : "red"}>
                          {diff === 0 ? "Balanced" : `${diff > 0 ? "+" : ""}${money(diff, currency)}`}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">{new Date(c.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <RefundModal key={refundTarget?.id ?? "ref"} payment={refundTarget} currency={currency} onClose={() => setRefundTarget(null)} />
    </div>
  );
}

void ArrowDownLeft; void Banknote; void Wallet;

