"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban, Calendar as CalendarIcon, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileText,
  List, Plus, Printer, Search, Sparkles, UserCheck, Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, Skeleton, STATUS_TONE } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PropertySelect, useProperties, usePropertySelection } from "@/components/property-select";
import { api, ApiError, money } from "@/lib/utils";

interface TimelineCabana {
  id: string; code: string; name: string; zone: string | null; status: string; cleaningStatus: string;
  maxAdults: number; maxChildren: number; hourlyEnabled: boolean; overnightEnabled: boolean;
  type: { name: string } | null;
}
interface TimelineItem {
  id: string; cabanaId: string; startAt: string; endAt: string; blocking: boolean; price: string;
  booking: {
    id: string; reference: string; type: string; source: string; status: string; paymentStatus: string;
    startAt: string; endAt: string; total: string; paidTotal: string; adults: number; children: number;
    holdExpiresAt: string | null;
    guest: { firstName: string; lastName: string; phone: string | null; isVip: boolean };
  };
}
interface TimelineResponse {
  property: { id: string; name: string; timezone: string; currency: string; turnaroundMinutes: number };
  cabanas: TimelineCabana[];
  items: TimelineItem[];
}
interface BookingDetail {
  id: string; reference: string; type: string; source: string; status: string; paymentStatus: string;
  startAt: string; endAt: string; adults: number; children: number; holdExpiresAt: string | null;
  subtotal: string; discountTotal: string; serviceChargeTotal: string; taxTotal: string; total: string;
  paidTotal: string; depositRequired: string; specialRequests: string | null; notes: string | null;
  cancelReason: string | null; createdAt: string;
  property: { id: string; name: string; currency: string; timezone: string };
  guest: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; nationality: string | null; isVip: boolean };
  items: { id: string; cabanaId: string; startAt: string; endAt: string; price: string; cabana: { id: string; code: string; name: string; status: string } }[];
  history: { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
  charges: { id: string; type: string; description: string; quantity: string; unitPrice: string; amount: string; createdAt: string }[];
}
interface QuoteResult {
  currency: string; timezone: string; subtotal: string; discount: string; serviceCharge: string; tax: string; total: string; deposit: string;
  items: { cabanaId: string; code: string; name: string; breakdown: { lines: { type: string; description: string; amount: string }[]; total: string } }[];
}

const BOOKING_TONE: Record<string, "green" | "blue" | "amber" | "red" | "gray" | "purple"> = {
  PENDING: "amber", CONFIRMED: "blue", CHECKED_IN: "purple", CHECKED_OUT: "green", CANCELLED: "red", NO_SHOW: "gray", EXPIRED: "gray",
};
const PAY_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  PAID: "green", PARTIALLY_PAID: "amber", UNPAID: "red", REFUND_PENDING: "amber", PARTIALLY_REFUNDED: "gray", REFUNDED: "gray", FAILED: "red",
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10);
};

function CreateBookingModal({
  open, onClose, propertyId, cabanas, currency, defaultCabanaId, defaultDate,
}: {
  open: boolean; onClose: () => void; propertyId: string; cabanas: TimelineCabana[]; currency: string;
  defaultCabanaId?: string; defaultDate: string;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState<"HOURLY" | "DAY_USE" | "OVERNIGHT" | "MULTI_NIGHT">("OVERNIGHT");
  const [source, setSource] = useState<"WALK_IN" | "PHONE" | "ADMIN">("WALK_IN");
  const [selected, setSelected] = useState<string[]>(defaultCabanaId ? [defaultCabanaId] : cabanas[0] ? [cabanas[0].id] : []);
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(addDays(defaultDate, 1));
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("14:00");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [extraBeds, setExtraBeds] = useState(0);
  const [promoCode, setPromoCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isHourly = type === "HOURLY" || type === "DAY_USE";
  const startAt = useMemo(() => (isHourly ? new Date(`${startDate}T${startTime}:00`) : new Date(`${startDate}T14:00:00`)), [isHourly, startDate, startTime]);
  const endAt = useMemo(() => (isHourly ? new Date(`${startDate}T${endTime}:00`) : new Date(`${endDate}T11:00:00`)), [isHourly, startDate, endDate, endTime]);

  const quote = useQuery({
    enabled: open && selected.length > 0 && endAt > startAt,
    queryKey: ["quote", propertyId, selected, type, startAt.toISOString(), endAt.toISOString(), adults, children, extraBeds, promoCode],
    queryFn: async () =>
      (await api<QuoteResult>("/api/bookings/quote", {
        method: "POST",
        body: { propertyId, cabanaIds: selected, type, startAt, endAt, adults, children, extraBeds, promoCode: promoCode || undefined },
      })).data,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/bookings", {
        method: "POST",
        body: {
          propertyId, cabanaIds: selected, type, source, startAt, endAt, adults, children, extraBeds,
          promoCode: promoCode || undefined,
          guest: { firstName, lastName, email: email || undefined, phone: phone || undefined },
          specialRequests: specialRequests || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timeline"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not create booking"),
  });

  const toggleCabana = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Dialog open={open} onClose={onClose} title="New Reservation" wide>
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950/40">{error}</p>}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Booking type">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="HOURLY">Hourly</option>
              <option value="DAY_USE">Day Use</option>
              <option value="OVERNIGHT">Overnight</option>
              <option value="MULTI_NIGHT">Multi-Night</option>
            </Select>
          </Field>
          <Field label="Source">
            <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
              <option value="WALK_IN">Walk-in</option>
              <option value="PHONE">Phone</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </Field>
          <Field label="Promo code (optional)">
            <Input placeholder="SUMMER20" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Select cabana(s)</p>
          <div className="flex flex-wrap gap-2">
            {cabanas.map((c) => {
              const disabled = ["MAINTENANCE", "INACTIVE"].includes(c.status);
              const active = selected.includes(c.id);
              return (
                <button
                  type="button" key={c.id} disabled={disabled} onClick={() => toggleCabana(c.id)}
                  className={`rounded-xl border px-3 py-1.5 text-left text-sm transition ${
                    active ? "border-teal bg-teal/10 font-medium text-teal" : "border-border hover:bg-surface-2"
                  } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  {c.code} · {c.name} <span className="text-xs text-muted">({c.maxAdults}A)</span>
                </button>
              );
            })}
          </div>
        </div>

        {isHourly ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="Start time"><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
            <Field label="End time"><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Check-in date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="Check-out date"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Adults"><Input type="number" min={1} max={50} value={adults} onChange={(e) => setAdults(Number(e.target.value))} /></Field>
          <Field label="Children"><Input type="number" min={0} max={50} value={children} onChange={(e) => setChildren(Number(e.target.value))} /></Field>
          <Field label="Extra beds"><Input type="number" min={0} max={10} value={extraBeds} onChange={(e) => setExtraBeds(Number(e.target.value))} /></Field>
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-3 text-sm font-medium">Guest details</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name *"><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
            <Field label="Last name *"><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
            <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          </div>
          <Field label="Special requests" className="mt-3">
            <Input value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} placeholder="Late arrival, dietary preferences..." />
          </Field>
        </div>

        <div className="rounded-xl border border-border bg-surface-2/60 p-4">
          <p className="text-sm font-semibold">Live Price Breakdown</p>
          {quote.isLoading && <p className="mt-2 text-xs text-muted">Calculating quote…</p>}
          {quote.error && <p className="mt-2 text-xs font-medium text-danger">{(quote.error as Error).message}</p>}
          {quote.data && (
            <div className="mt-2 space-y-1.5 text-sm">
              {quote.data.items.map((it) => (
                <div key={it.cabanaId} className="space-y-0.5">
                  <p className="text-xs font-semibold text-muted">{it.code} — {it.name}</p>
                  {it.breakdown.lines.map((l, idx) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span>{l.description}</span>
                      <span>{money(l.amount, currency)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <span>Total</span>
                <span className="text-teal">{money(quote.data.total, currency)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted">
                <span>Required deposit</span>
                <span>{money(quote.data.deposit, currency)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!selected.length || !firstName.trim() || !lastName.trim() || endAt <= startAt}
            loading={create.isPending}
            onClick={() => { setError(null); create.mutate(); }}
          >
            Confirm Reservation
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function BookingDetailDrawer({ bookingId, onClose }: { bookingId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [chargeDesc, setChargeDesc] = useState("");
  const [chargeAmt, setChargeAmt] = useState("");
  const [chargeType, setChargeType] = useState("SERVICE");
  const [notes, setNotes] = useState("");

  const { data: b, isLoading, error } = useQuery({
    enabled: !!bookingId,
    queryKey: ["booking", bookingId],
    queryFn: async () => (await api<BookingDetail>(`/api/bookings/${bookingId}`)).data,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["booking", bookingId] });
    qc.invalidateQueries({ queryKey: ["timeline"] });
    qc.invalidateQueries({ queryKey: ["bookings"] });
  };

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/api/bookings/${bookingId}`, { method: "PATCH", body }),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => api(`/api/bookings/${bookingId}`, { method: "DELETE", body: { reason: cancelReason } }),
    onSuccess: () => { setShowCancel(false); setCancelReason(""); refresh(); },
  });
  const addCharge = useMutation({
    mutationFn: () => api(`/api/bookings/${bookingId}/charges`, { method: "POST", body: { type: chargeType, description: chargeDesc, quantity: 1, unitPrice: Number(chargeAmt) } }),
    onSuccess: () => { setChargeDesc(""); setChargeAmt(""); refresh(); },
  });

  if (!bookingId) return null;
  const currency = b?.property.currency ?? "LKR";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-border pb-4">
          <div>
            <p className="font-mono text-xs text-muted">{b?.reference ?? "Loading…"}</p>
            <h2 className="text-lg font-semibold">
              {b ? `${b.guest.firstName} ${b.guest.lastName}` : "Reservation Detail"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {b && (
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                <Printer className="size-3.5" /> Print
              </Button>
            )}
            <button onClick={onClose} aria-label="Close drawer" className="rounded-lg p-1.5 text-muted hover:bg-surface-2"><X className="size-5" /></button>
          </div>
        </div>

        {isLoading && <div className="mt-6 space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>}
        {error && <div className="mt-4"><ErrorState message={(error as Error).message} /></div>}

        {b && (
          <div className="mt-5 space-y-6 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={BOOKING_TONE[b.status] ?? "gray"}>{b.status}</Badge>
              <Badge tone={PAY_TONE[b.paymentStatus] ?? "gray"}>{b.paymentStatus}</Badge>
              <Badge>{b.type}</Badge>
              <Badge>Source: {b.source}</Badge>
              {b.guest.isVip && <Badge tone="amber"><Sparkles className="mr-1 size-3" />VIP</Badge>}
            </div>

            {b.status === "PENDING" && b.holdExpiresAt && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                Temporary hold expires at <b>{new Date(b.holdExpiresAt).toLocaleString()}</b>.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border p-4">
              <div><p className="text-xs text-muted">Start</p><p className="font-medium">{new Date(b.startAt).toLocaleString()}</p></div>
              <div><p className="text-xs text-muted">End</p><p className="font-medium">{new Date(b.endAt).toLocaleString()}</p></div>
              <div><p className="text-xs text-muted">Guests</p><p className="font-medium">{b.adults} Adult(s), {b.children} Child(ren)</p></div>
              <div><p className="text-xs text-muted">Contact</p><p className="font-medium">{b.guest.phone || b.guest.email || "—"}</p></div>
            </div>

            <div>
              <p className="mb-2 font-semibold">Cabanas</p>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {b.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between px-4 py-2.5">
                    <span><b>{it.cabana.code}</b> · {it.cabana.name}</span>
                    <span className="font-medium">{money(it.price, currency)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="mb-2 font-semibold">Financial Summary & Folio</p>
              <div className="space-y-1.5 rounded-xl border border-border p-4">
                <div className="flex justify-between"><span>Room subtotal</span><span>{money(b.subtotal, currency)}</span></div>
                {Number(b.discountTotal) > 0 && <div className="flex justify-between text-emerald-600"><span>Discount</span><span>-{money(b.discountTotal, currency)}</span></div>}
                {Number(b.serviceChargeTotal) > 0 && <div className="flex justify-between"><span>Service charge</span><span>{money(b.serviceChargeTotal, currency)}</span></div>}
                {Number(b.taxTotal) > 0 && <div className="flex justify-between"><span>Tax</span><span>{money(b.taxTotal, currency)}</span></div>}
                {b.charges.map((c) => (
                  <div key={c.id} className="flex justify-between text-xs text-muted">
                    <span>+ {c.description} ({c.type})</span>
                    <span>{money(c.amount, currency)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-2 font-semibold">
                  <span>Total</span><span>{money(b.total, currency)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted">
                  <span>Paid / Balance due</span>
                  <span>{money(b.paidTotal, currency)} / <b>{money(Number(b.total) - Number(b.paidTotal), currency)}</b></span>
                </div>
              </div>

              {!["CANCELLED", "EXPIRED"].includes(b.status) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Select value={chargeType} onChange={(e) => setChargeType(e.target.value)} className="w-36">
                    <option value="SERVICE">Service</option>
                    <option value="EXTRA_GUEST">Extra guest</option>
                    <option value="EXTRA_BED">Extra bed</option>
                    <option value="EARLY_CHECKIN">Early check-in</option>
                    <option value="LATE_CHECKOUT">Late check-out</option>
                    <option value="OTHER">Other</option>
                  </Select>
                  <Input placeholder="Charge description" value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} className="flex-1" />
                  <Input type="number" step="0.01" placeholder="Amount" value={chargeAmt} onChange={(e) => setChargeAmt(e.target.value)} className="w-28" />
                  <Button size="sm" variant="secondary" disabled={!chargeDesc || !Number(chargeAmt)} loading={addCharge.isPending} onClick={() => addCharge.mutate()}>
                    <Plus className="size-3.5" /> Add
                  </Button>
                </div>
              )}
            </div>

            <div>
              <p className="mb-1.5 font-semibold">Booking Notes</p>
              <div className="flex gap-2">
                <Textarea
                  defaultValue={b.notes ?? ""}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Internal staff notes…"
                  className="min-h-16"
                />
                <Button size="sm" variant="secondary" loading={patch.isPending} onClick={() => patch.mutate({ notes })}>Save</Button>
              </div>
            </div>

            {!["CANCELLED", "CHECKED_OUT", "EXPIRED"].includes(b.status) && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                {b.status === "PENDING" && (
                  <Button size="sm" loading={patch.isPending} onClick={() => patch.mutate({ status: "CONFIRMED" })}>
                    <CheckCircle2 className="size-4" /> Confirm Hold
                  </Button>
                )}
                {b.status === "CONFIRMED" && (
                  <Button size="sm" variant="secondary" loading={patch.isPending} onClick={() => patch.mutate({ status: "NO_SHOW" })}>
                    <UserCheck className="size-4" /> Mark No-Show
                  </Button>
                )}
                {b.status !== "CHECKED_IN" && (
                  <Button size="sm" variant="danger" onClick={() => setShowCancel((s) => !s)}>
                    <Ban className="size-4" /> Cancel Booking
                  </Button>
                )}
              </div>
            )}

            {showCancel && (
              <div className="space-y-2 rounded-xl border border-red-200 bg-red-50/70 p-3 dark:border-red-900 dark:bg-red-950/30">
                <p className="text-xs font-medium text-danger">Provide a reason. Any applicable policy fee will be added automatically and the cabana slot released.</p>
                <Input placeholder="Guest requested cancellation…" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                {cancel.error && <p className="text-xs text-danger">{(cancel.error as Error).message}</p>}
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setShowCancel(false)}>Keep</Button>
                  <Button size="sm" variant="danger" disabled={cancelReason.trim().length < 2} loading={cancel.isPending} onClick={() => cancel.mutate()}>Confirm Cancellation</Button>
                </div>
              </div>
            )}

            <div>
              <p className="mb-2 font-semibold">Status History</p>
              <ul className="space-y-1.5 text-xs text-muted">
                {b.history.map((h) => (
                  <li key={h.id} className="flex justify-between gap-2">
                    <span>{h.fromStatus ? `${h.fromStatus} → ` : ""}<b className="text-foreground">{h.toStatus}</b>{h.note ? ` · ${h.note}` : ""}</span>
                    <time>{new Date(h.createdAt).toLocaleString()}</time>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export function BookingsClient() {
  const props = useProperties();
  const [pid, setPid] = usePropertySelection(props.data);
  const [view, setView] = useState<"timeline" | "day" | "list">("timeline");
  const [anchorDate, setAnchorDate] = useState(() => isoDate(new Date()));
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [createModal, setCreateModal] = useState<{ open: boolean; cabanaId?: string; date?: string }>({ open: false });
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(anchorDate, i)), [anchorDate]);
  const hours = useMemo(() => Array.from({ length: 15 }, (_, i) => i + 7), []); // 07:00..21:00

  const rangeFrom = view === "day" ? `${anchorDate}T00:00:00.000Z` : `${days[0]}T00:00:00.000Z`;
  const rangeTo = view === "day" ? `${addDays(anchorDate, 1)}T23:59:59.000Z` : `${addDays(days[days.length - 1], 1)}T00:00:00.000Z`;

  const timeline = useQuery({
    enabled: !!pid,
    queryKey: ["timeline", pid, rangeFrom, rangeTo],
    queryFn: async () =>
      (await api<TimelineResponse>(`/api/bookings/availability?propertyId=${pid}&from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`)).data,
  });

  const list = useQuery({
    enabled: !!pid && view === "list",
    queryKey: ["bookings", pid, q, statusFilter],
    queryFn: async () =>
      (await api<
        {
          id: string; reference: string; type: string; source: string; status: string; paymentStatus: string;
          startAt: string; endAt: string; total: string; adults: number; children: number;
          guest: { firstName: string; lastName: string }; items: { cabanaId: string }[];
        }[]
      >(`/api/bookings?propertyId=${pid}&q=${encodeURIComponent(q)}${statusFilter ? `&status=${statusFilter}` : ""}`)).data,
  });

  const currency = timeline.data?.property.currency ?? "LKR";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Bookings & Availability</h1>
          <p className="text-sm text-muted">Multi-night calendar, hourly timeline, live pricing and reservation management.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.data && <PropertySelect props={props.data} value={pid} onChange={setPid} />}
          <Button onClick={() => setCreateModal({ open: true, date: anchorDate })} disabled={!pid}>
            <Plus className="size-4" /> New Booking
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-border bg-surface p-1">
          <button
            onClick={() => setView("timeline")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${view === "timeline" ? "bg-teal text-white" : "text-muted hover:text-foreground"}`}
          >
            <CalendarIcon className="size-4" /> 14-Day Calendar
          </button>
          <button
            onClick={() => setView("day")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${view === "day" ? "bg-teal text-white" : "text-muted hover:text-foreground"}`}
          >
            <Clock className="size-4" /> Hourly Day Timeline
          </button>
          <button
            onClick={() => setView("list")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${view === "list" ? "bg-teal text-white" : "text-muted hover:text-foreground"}`}
          >
            <List className="size-4" /> All Bookings
          </button>
        </div>

        {view !== "list" ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAnchorDate(addDays(anchorDate, view === "day" ? -1 : -7))}>
              <ChevronLeft className="size-4" />
            </Button>
            <Input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className="w-40" />
            <Button size="sm" variant="secondary" onClick={() => setAnchorDate(isoDate(new Date()))}>Today</Button>
            <Button size="sm" variant="secondary" onClick={() => setAnchorDate(addDays(anchorDate, view === "day" ? 1 : 7))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <div className="relative w-60">
              <Search className="absolute left-3 top-3 size-4 text-muted" />
              <Input className="pl-9" placeholder="Reference or last name…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
              <option value="">All statuses</option>
              {["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW", "EXPIRED"].map((s) => <option key={s}>{s}</option>)}
            </Select>
          </div>
        )}
      </div>

      {timeline.error && <ErrorState message={(timeline.error as Error).message} onRetry={() => timeline.refetch()} />}
      {timeline.isLoading && <Skeleton className="h-80" />}

      {view === "timeline" && timeline.data && (
        timeline.data.cabanas.length === 0 ? (
          <EmptyState title="No cabanas yet" text="Create cabanas and rate plans first to use the availability calendar." />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-2/60 text-left">
                  <th className="sticky left-0 z-10 w-48 bg-surface-2 px-3 py-2.5 font-semibold">Cabana</th>
                  {days.map((d) => {
                    const wd = new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
                    return (
                      <th key={d} className="border-l border-border px-2 py-2 text-center font-medium">
                        <div className="text-[11px] text-muted">{wd}</div>
                        <div>{d.slice(5)}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {timeline.data.cabanas.map((c) => {
                  const cItems = timeline.data.items.filter((it) => it.cabanaId === c.id);
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="sticky left-0 z-10 bg-surface px-3 py-2.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold">{c.code}</span>
                          <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                        </div>
                        <div className="truncate text-muted">{c.name}</div>
                      </td>
                      {days.map((d) => {
                        const dayStart = new Date(`${d}T00:00:00.000Z`).getTime();
                        const dayEnd = new Date(`${d}T23:59:59.999Z`).getTime();
                        const match = cItems.find((it) => new Date(it.startAt).getTime() <= dayEnd && new Date(it.endAt).getTime() > dayStart);
                        return (
                          <td
                            key={d}
                            onClick={() =>
                              match
                                ? setActiveBookingId(match.booking.id)
                                : !["MAINTENANCE", "INACTIVE"].includes(c.status) && setCreateModal({ open: true, cabanaId: c.id, date: d })
                            }
                            className="h-14 cursor-pointer border-l border-border p-1 align-top transition hover:bg-surface-2/70"
                          >
                            {match && (
                              <div className="rounded-lg bg-teal/15 px-1.5 py-1 text-[11px] leading-tight text-teal dark:bg-teal/25">
                                <div className="truncate font-semibold">{match.booking.guest.lastName}</div>
                                <div className="truncate text-[10px] opacity-80">{match.booking.status}</div>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )
      )}

      {view === "day" && timeline.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-2/60">
                <th className="sticky left-0 z-10 w-48 bg-surface-2 px-3 py-2.5 text-left font-semibold">Cabana · {anchorDate}</th>
                {hours.map((h) => (
                  <th key={h} className="border-l border-border px-2 py-2 text-center font-medium">{String(h).padStart(2, "0")}:00</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeline.data.cabanas.map((c) => {
                const cItems = timeline.data.items.filter((it) => it.cabanaId === c.id);
                return (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2.5">
                      <div className="font-semibold">{c.code} · {c.name}</div>
                      <div className="text-muted"><Users className="mr-1 inline size-3" />{c.maxAdults}A</div>
                    </td>
                    {hours.map((h) => {
                      const slotStart = new Date(`${anchorDate}T${String(h).padStart(2, "0")}:00:00`).getTime();
                      const slotEnd = slotStart + 3600_000;
                      const match = cItems.find((it) => new Date(it.startAt).getTime() < slotEnd && new Date(it.endAt).getTime() > slotStart);
                      return (
                        <td
                          key={h}
                          onClick={() =>
                            match
                              ? setActiveBookingId(match.booking.id)
                              : setCreateModal({ open: true, cabanaId: c.id, date: anchorDate })
                          }
                          className="h-12 cursor-pointer border-l border-border p-1 hover:bg-surface-2/70"
                        >
                          {match && (
                            <div className="truncate rounded bg-sky-500/20 px-1 py-0.5 text-[10px] font-medium text-sky-800 dark:text-sky-200">
                              {match.booking.guest.lastName}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {view === "list" && (
        list.isLoading ? (
          <Skeleton className="h-64" />
        ) : list.data?.length === 0 ? (
          <EmptyState title="No bookings found" text="Create a reservation or adjust your filters." />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="border-b border-border text-left text-muted">
                <tr>
                  {["Reference", "Guest", "Type", "Start", "End", "Status", "Payment", "Total", ""].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data?.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0 hover:bg-surface-2/40">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{b.reference}</td>
                    <td className="px-4 py-3">{b.guest.firstName} {b.guest.lastName}</td>
                    <td className="px-4 py-3"><Badge>{b.type}</Badge></td>
                    <td className="px-4 py-3 text-xs">{new Date(b.startAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs">{new Date(b.endAt).toLocaleString()}</td>
                    <td className="px-4 py-3"><Badge tone={BOOKING_TONE[b.status]}>{b.status}</Badge></td>
                    <td className="px-4 py-3"><Badge tone={PAY_TONE[b.paymentStatus]}>{b.paymentStatus}</Badge></td>
                    <td className="px-4 py-3 font-medium">{money(b.total, currency)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setActiveBookingId(b.id)}>
                        <FileText className="size-3.5" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}

      {createModal.open && timeline.data && (
        <CreateBookingModal
          open={createModal.open}
          onClose={() => setCreateModal({ open: false })}
          propertyId={pid}
          cabanas={timeline.data.cabanas}
          currency={currency}
          defaultCabanaId={createModal.cabanaId}
          defaultDate={createModal.date ?? anchorDate}
        />
      )}

      <BookingDetailDrawer bookingId={activeBookingId} onClose={() => setActiveBookingId(null)} />
    </div>
  );
}

