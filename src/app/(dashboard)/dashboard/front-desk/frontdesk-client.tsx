"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote, BedDouble, CheckCircle2, Clock, CreditCard, DoorOpen, LogIn, LogOut,
  Plus, Printer, Receipt, Search, ShieldAlert, Sparkles, UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, Skeleton, STATUS_TONE } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { PropertySelect, useProperties, usePropertySelection } from "@/components/property-select";
import { api, ApiError, money } from "@/lib/utils";

interface FDItem {
  id: string; cabanaId: string; price: string;
  cabana: { id: string; code: string; name: string; status: string; cleaningStatus: string };
}
interface FDBooking {
  id: string; reference: string; type: string; source: string; status: string; paymentStatus: string;
  startAt: string; endAt: string; adults: number; children: number;
  subtotal: string; total: string; paidTotal: string; specialRequests: string | null;
  guest: {
    id: string; firstName: string; lastName: string; phone: string | null; email: string | null;
    idType: string | null; idNumber: string | null; isVip: boolean; isBlacklisted: boolean;
  };
  items: FDItem[];
  charges: { id: string; type: string; description: string; amount: string }[];
}
interface FDCabana {
  id: string; code: string; name: string; zone: string | null; status: string; cleaningStatus: string; maxAdults: number;
}
interface FDFeed {
  property: { id: string; name: string; currency: string; timezone: string };
  date: string;
  arrivals: FDBooking[];
  departures: FDBooking[];
  inHouse: FDBooking[];
  cabanas: FDCabana[];
}

function CheckInModal({ booking, currency, onClose }: { booking: FDBooking | null; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [idType, setIdType] = useState<"NIC" | "PASSPORT" | "DRIVING_LICENSE">(
    (booking?.guest.idType as "NIC" | "PASSPORT" | "DRIVING_LICENSE") ?? "NIC",
  );
  const [idNumber, setIdNumber] = useState(booking?.guest.idNumber ?? "");
  const [phone, setPhone] = useState(booking?.guest.phone ?? "");
  const [earlyFee, setEarlyFee] = useState("0");
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      api(`/api/bookings/${booking!.id}/checkin`, {
        method: "POST",
        body: {
          idType,
          idNumber: idNumber || undefined,
          phone: phone || undefined,
          earlyCheckInFee: Number(earlyFee) > 0 ? Number(earlyFee) : undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["frontdesk"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Check-in failed"),
  });

  return (
    <Dialog open={!!booking} onClose={onClose} title={`Check-In · ${booking?.reference ?? ""}`}>
      {booking && (
        <div className="space-y-4 text-sm">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-danger dark:bg-red-950/40">{error}</p>}
          <div className="rounded-xl border border-border p-3">
            <p className="font-semibold">{booking.guest.firstName} {booking.guest.lastName}</p>
            <p className="text-xs text-muted">
              Cabana(s): {booking.items.map((i) => `${i.cabana.code} (${i.cabana.cleaningStatus})`).join(", ")}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ID Document Type">
              <Select value={idType} onChange={(e) => setIdType(e.target.value as typeof idType)}>
                <option value="NIC">NIC</option>
                <option value="PASSPORT">Passport</option>
                <option value="DRIVING_LICENSE">Driving License</option>
              </Select>
            </Field>
            <Field label="ID / Passport Number">
              <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="Verify at desk" />
            </Field>
            <Field label="Guest Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label={`Early check-in fee (${currency})`}>
              <Input type="number" step="0.01" value={earlyFee} onChange={(e) => setEarlyFee(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={m.isPending} onClick={() => { setError(null); m.mutate(); }}>
              <LogIn className="size-4" /> Complete Check-In
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function CheckOutModal({ booking, currency, onClose }: { booking: FDBooking | null; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [lateFee, setLateFee] = useState("0");
  const [allowUnpaid, setAllowUnpaid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balance = booking ? Math.max(0, Number(booking.total) + (Number(lateFee) || 0) - Number(booking.paidTotal)) : 0;

  const m = useMutation({
    mutationFn: () =>
      api(`/api/bookings/${booking!.id}/checkout`, {
        method: "POST",
        body: {
          lateCheckOutFee: Number(lateFee) > 0 ? Number(lateFee) : undefined,
          allowUnpaidCheckout: allowUnpaid,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["frontdesk"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Check-out failed"),
  });

  return (
    <Dialog open={!!booking} onClose={onClose} title={`Check-Out · ${booking?.reference ?? ""}`}>
      {booking && (
        <div className="space-y-4 text-sm">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-danger dark:bg-red-950/40">{error}</p>}
          <div className="space-y-1.5 rounded-xl border border-border p-4">
            <div className="flex justify-between"><span>Folio total</span><span className="font-medium">{money(Number(booking.total) + (Number(lateFee) || 0), currency)}</span></div>
            <div className="flex justify-between"><span>Paid so far</span><span>{money(booking.paidTotal, currency)}</span></div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold">
              <span>Balance due</span>
              <span className={balance > 0 ? "text-danger" : "text-emerald-600"}>{money(balance, currency)}</span>
            </div>
          </div>

          <Field label={`Late check-out fee (${currency})`}>
            <Input type="number" step="0.01" value={lateFee} onChange={(e) => setLateFee(e.target.value)} />
          </Field>

          {balance > 0 && (
            <Checkbox
              label="Authorize check-out with unpaid balance (post to city ledger / receivable)"
              checked={allowUnpaid}
              onChange={(e) => setAllowUnpaid(e.target.checked)}
            />
          )}

          <p className="text-xs text-muted">
            Checking out will release the reservation slot, set the cabana to <b>CLEANING (DIRTY)</b>, and automatically assign a high-priority cleaning task to Housekeeping.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={m.isPending} onClick={() => { setError(null); m.mutate(); }}>
              <LogOut className="size-4" /> Complete Check-Out
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function CollectPaymentModal({ booking, currency, onClose }: { booking: FDBooking | null; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const due = booking ? Math.max(0, Number(booking.total) - Number(booking.paidTotal)) : 0;
  const [amount, setAmount] = useState(due > 0 ? due.toFixed(2) : "");
  const [method, setMethod] = useState<"CASH" | "CARD" | "BANK_TRANSFER">("CASH");
  const [ref, setRef] = useState("");
  const [receipt, setReceipt] = useState<{ receiptNo: string; amount: string; method: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: async () =>
      (await api<{ payment: { receiptNo: string; amount: string; method: string } }>("/api/frontdesk", {
        method: "POST",
        body: { bookingId: booking!.id, method, amount: Number(amount), providerRef: ref || undefined },
      })).data,
    onSuccess: (res) => {
      setReceipt(res.payment);
      qc.invalidateQueries({ queryKey: ["frontdesk"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Payment failed"),
  });

  return (
    <Dialog open={!!booking} onClose={() => { setReceipt(null); onClose(); }} title={`Collect Payment · ${booking?.reference ?? ""}`}>
      {booking && (
        receipt ? (
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
              <p className="font-semibold text-emerald-900 dark:text-emerald-200">Payment Recorded</p>
              <p className="mt-1 font-mono text-xs">Receipt: {receipt.receiptNo}</p>
              <p className="mt-1">Amount: <b>{money(receipt.amount, currency)}</b> ({receipt.method})</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print Receipt</Button>
              <Button onClick={() => { setReceipt(null); onClose(); }}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-danger dark:bg-red-950/40">{error}</p>}
            <div className="flex justify-between rounded-xl border border-border p-3">
              <span>Total: <b>{money(booking.total, currency)}</b></span>
              <span>Paid: <b>{money(booking.paidTotal, currency)}</b></span>
              <span>Balance: <b className="text-teal">{money(due, currency)}</b></span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Payment method">
                <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card (POS Terminal)</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                </Select>
              </Field>
              <Field label={`Amount (${currency})`}>
                <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            </div>
            <Field label="Slip / Terminal Reference (optional)">
              <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="POS approval code or transfer ref" />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button disabled={!Number(amount) || Number(amount) <= 0} loading={m.isPending} onClick={() => { setError(null); m.mutate(); }}>
                <Receipt className="size-4" /> Record Payment
              </Button>
            </div>
          </div>
        )
      )}
    </Dialog>
  );
}

export function FrontDeskClient() {
  const props = useProperties();
  const [pid, setPid] = usePropertySelection(props.data);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [checkInTarget, setCheckInTarget] = useState<FDBooking | null>(null);
  const [checkOutTarget, setCheckOutTarget] = useState<FDBooking | null>(null);
  const [payTarget, setPayTarget] = useState<FDBooking | null>(null);

  const feed = useQuery({
    enabled: !!pid,
    queryKey: ["frontdesk", pid, date],
    queryFn: async () => (await api<FDFeed>(`/api/frontdesk?propertyId=${pid}&date=${date}`)).data,
  });

  const currency = feed.data?.property.currency ?? "LKR";
  const matchSearch = (b: FDBooking) =>
    !search ||
    b.reference.toLowerCase().includes(search.toLowerCase()) ||
    `${b.guest.firstName} ${b.guest.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
    b.items.some((i) => i.cabana.code.toLowerCase().includes(search.toLowerCase()));

  const renderCard = (b: FDBooking, mode: "arrival" | "departure" | "inhouse") => {
    const due = Math.max(0, Number(b.total) - Number(b.paidTotal));
    return (
      <div key={b.id} className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-semibold text-muted">{b.reference}</span>
            <div className="flex items-center gap-1">
              {b.guest.isVip && <Badge tone="amber"><Sparkles className="mr-1 size-3" />VIP</Badge>}
              {b.guest.isBlacklisted && <Badge tone="red"><ShieldAlert className="mr-1 size-3" />Blocked</Badge>}
              <Badge tone={due === 0 ? "green" : "amber"}>{b.paymentStatus}</Badge>
            </div>
          </div>
          <p className="font-semibold">{b.guest.firstName} {b.guest.lastName}</p>
          <p className="text-xs text-muted">
            {b.items.map((i) => i.cabana.code).join(", ")} · {b.adults}A{b.children ? ` + ${b.children}C` : ""} · {b.type}
          </p>
          <p className="text-xs text-muted">
            Total: <b>{money(b.total, currency)}</b> · Due: <b className={due > 0 ? "text-danger" : "text-emerald-600"}>{money(due, currency)}</b>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {mode === "arrival" && (
            <Button size="sm" onClick={() => setCheckInTarget(b)}>
              <LogIn className="size-3.5" /> Check-In
            </Button>
          )}
          {(mode === "departure" || mode === "inhouse") && (
            <Button size="sm" onClick={() => setCheckOutTarget(b)}>
              <LogOut className="size-3.5" /> Check-Out
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setPayTarget(b)}>
            <Banknote className="size-3.5" /> Collect Payment
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.print()} aria-label="Print folio">
            <Printer className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Front Desk Workspace</h1>
          <p className="text-sm text-muted">Today&apos;s arrivals, departures, in-house guests, payment collection and live cabana board.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.data && <PropertySelect props={props.data} value={pid} onChange={setPid} />}
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          <a href="/dashboard/bookings" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal px-4 text-sm font-medium text-white hover:bg-teal-600">
            <UserPlus className="size-4" /> Walk-In Booking
          </a>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-3 size-4 text-muted" />
        <Input className="pl-9" placeholder="Filter by guest, booking reference or cabana code…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {feed.error && <ErrorState message={(feed.error as Error).message} onRetry={() => feed.refetch()} />}
      {feed.isLoading && <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div>}

      {feed.data && (
        <>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold"><DoorOpen className="size-4 text-teal" /> Arrivals ({feed.data.arrivals.filter(matchSearch).length})</h2>
              </div>
              {feed.data.arrivals.filter(matchSearch).length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">No arrivals scheduled for {date}.</p>
              ) : (
                <div className="space-y-3">{feed.data.arrivals.filter(matchSearch).map((b) => renderCard(b, "arrival"))}</div>
              )}
            </Card>

            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold"><Clock className="size-4 text-amber-600" /> Departures ({feed.data.departures.filter(matchSearch).length})</h2>
              </div>
              {feed.data.departures.filter(matchSearch).length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">No departures due on {date}.</p>
              ) : (
                <div className="space-y-3">{feed.data.departures.filter(matchSearch).map((b) => renderCard(b, "departure"))}</div>
              )}
            </Card>

            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold"><BedDouble className="size-4 text-violet-600" /> In-House ({feed.data.inHouse.filter(matchSearch).length})</h2>
              </div>
              {feed.data.inHouse.filter(matchSearch).length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">No guests currently checked in.</p>
              ) : (
                <div className="space-y-3">{feed.data.inHouse.filter(matchSearch).map((b) => renderCard(b, "inhouse"))}</div>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Live Cabana Availability & Readiness Board</h2>
            {feed.data.cabanas.length === 0 ? (
              <EmptyState title="No cabanas" text="Add cabanas in the Cabanas section." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {feed.data.cabanas.map((c) => (
                  <div key={c.id} className="rounded-xl border border-border p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{c.code}</span>
                      <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                    </div>
                    <p className="mt-1 truncate font-medium">{c.name}</p>
                    <p className="mt-1 text-muted">Housekeeping: <b>{c.cleaningStatus}</b></p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      <CheckInModal key={checkInTarget?.id ?? "ci"} booking={checkInTarget} currency={currency} onClose={() => setCheckInTarget(null)} />
      <CheckOutModal key={checkOutTarget?.id ?? "co"} booking={checkOutTarget} currency={currency} onClose={() => setCheckOutTarget(null)} />
      <CollectPaymentModal key={payTarget?.id ?? "pay"} booking={payTarget} currency={currency} onClose={() => setPayTarget(null)} />
    </div>
  );
}

void CheckCircle2; void CreditCard; void Plus;

