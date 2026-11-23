"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calendar, Gift, Percent, Plus, Sparkles, Tag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { PropertySelect, useProperties, usePropertySelection } from "@/components/property-select";
import { api, ApiError, money } from "@/lib/utils";

interface SeasonalRate {
  id: string; name: string; startDate: string; endDate: string; multiplier: string; isPeak: boolean; priority: number;
}
interface Rate {
  id: string; name: string; kind: "HOURLY" | "DAY_USE" | "OVERNIGHT"; weekdayRate: string; weekendRate: string; holidayRate: string | null;
  extraAdultFee: string; extraChildFee: string; extraBedFee: string; includedAdults: number;
  earlyCheckInFeePerHour: string; lateCheckOutFeePerHour: string; multiNightDiscountPercent: string; isCorporate: boolean;
  cabana: { code: string; name: string } | null;
  seasonalRates: SeasonalRate[];
}
interface CabanaOpt { id: string; code: string; name: string }
interface Holiday { id: string; date: string; name: string }
interface Promo { id: string; code: string; type: "PERCENT" | "FIXED"; value: string; maxUses: number | null; usedCount: number; minAmount: string | null; isActive: boolean }
interface Pkg { id: string; name: string; description: string | null; price: string; inclusions: string[] | null; isActive: boolean }

const KIND_LABEL = { HOURLY: "Per hour", DAY_USE: "Day use", OVERNIGHT: "Per night" } as const;
const n = (min = 0, max = 100_000_000) => z.number({ error: "Enter a number" }).min(min).max(max);
const schema = z.object({
  name: z.string().trim().min(2, "At least 2 characters"),
  kind: z.enum(["HOURLY", "DAY_USE", "OVERNIGHT"]),
  cabanaId: z.string(),
  weekdayRate: n(), weekendRate: n(),
  holidayRate: z.union([n(), z.nan()]),
  extraAdultFee: n(), extraChildFee: n(), extraBedFee: n(),
  earlyCheckInFeePerHour: n(), lateCheckOutFeePerHour: n(),
  includedAdults: n(1, 30).int(),
  multiNightDiscountPercent: n(0, 100),
  isCorporate: z.boolean(),
});
type V = z.infer<typeof schema>;

function RateForm({ propertyId, cabanas, onDone }: { propertyId: string; cabanas: CabanaOpt[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", kind: "OVERNIGHT", cabanaId: "", weekdayRate: 0, weekendRate: 0, holidayRate: NaN,
      extraAdultFee: 0, extraChildFee: 0, extraBedFee: 0, earlyCheckInFeePerHour: 0, lateCheckOutFeePerHour: 0,
      includedAdults: 2, multiNightDiscountPercent: 0, isCorporate: false,
    },
  });
  const m = useMutation({
    mutationFn: ({ cabanaId, holidayRate, ...v }: V) =>
      api("/api/rate-plans", { method: "POST", body: { ...v, propertyId, cabanaId: cabanaId || null, holidayRate: Number.isNaN(holidayRate) ? null : holidayRate } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rates", propertyId] }); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save rate"),
  });
  const num = (k: keyof V) => register(k, { valueAsNumber: true });
  return (
    <form onSubmit={handleSubmit((v) => { setError(null); m.mutate(v); })} className="space-y-4" noValidate>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950/40">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rate name" error={errors.name?.message}><Input placeholder="Standard overnight" {...register("name")} /></Field>
        <Field label="Charged"><Select {...register("kind")}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Applies to" hint="Cabana-specific overrides property default"><Select {...register("cabanaId")}><option value="">All cabanas (default)</option>{cabanas.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</Select></Field>
        <Field label="Included adults" error={errors.includedAdults?.message}><Input type="number" {...num("includedAdults")} /></Field>
        <Field label="Weekday rate" error={errors.weekdayRate?.message}><Input type="number" step="0.01" {...num("weekdayRate")} /></Field>
        <Field label="Weekend rate (Fri–Sat)" error={errors.weekendRate?.message}><Input type="number" step="0.01" {...num("weekendRate")} /></Field>
        <Field label="Public-holiday rate" hint="Optional" error={errors.holidayRate?.message}><Input type="number" step="0.01" {...num("holidayRate")} /></Field>
        <Field label="Multi-night discount %" error={errors.multiNightDiscountPercent?.message}><Input type="number" step="0.01" {...num("multiNightDiscountPercent")} /></Field>
        <Field label="Extra adult fee" error={errors.extraAdultFee?.message}><Input type="number" step="0.01" {...num("extraAdultFee")} /></Field>
        <Field label="Child fee" error={errors.extraChildFee?.message}><Input type="number" step="0.01" {...num("extraChildFee")} /></Field>
        <Field label="Extra bed fee" error={errors.extraBedFee?.message}><Input type="number" step="0.01" {...num("extraBedFee")} /></Field>
        <Field label="Early check-in / hour" error={errors.earlyCheckInFeePerHour?.message}><Input type="number" step="0.01" {...num("earlyCheckInFeePerHour")} /></Field>
        <Field label="Late check-out / hour" error={errors.lateCheckOutFeePerHour?.message}><Input type="number" step="0.01" {...num("lateCheckOutFeePerHour")} /></Field>
      </div>
      <Checkbox label="Corporate rate plan" {...register("isCorporate")} />
      <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit" loading={m.isPending}>Create rate</Button></div>
    </form>
  );
}

function SeasonModal({ rate, propertyId, onClose }: { rate: Rate | null; propertyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [multiplier, setMultiplier] = useState("1.25");
  const [isPeak, setIsPeak] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () =>
      api("/api/seasonal-rates", {
        method: "POST",
        body: { ratePlanId: rate!.id, name, startDate, endDate, multiplier: Number(multiplier), isPeak, priority: isPeak ? 10 : 1 },
      }),
    onSuccess: () => { setName(""); setErr(null); qc.invalidateQueries({ queryKey: ["rates", propertyId] }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Could not add season"),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/seasonal-rates?id=${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rates", propertyId] }),
  });

  return (
    <Dialog open={!!rate} onClose={onClose} title={`Seasonal multipliers · ${rate?.name ?? ""}`} wide>
      {rate && (
        <div className="space-y-4">
          {rate.seasonalRates.length === 0 ? (
            <p className="text-sm text-muted">No seasonal rules on this rate plan yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {rate.seasonalRates.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="font-medium">{s.name}</span>{" "}
                    {s.isPeak && <Badge tone="amber" className="ml-1">Peak</Badge>}
                    <p className="text-xs text-muted">{s.startDate.slice(0, 10)} → {s.endDate.slice(0, 10)} · ×{Number(s.multiplier)}</p>
                  </div>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => del.mutate(s.id)}><Trash2 className="size-3.5" /></Button>
                </li>
              ))}
            </ul>
          )}
          {err && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger">{err}</p>}
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Season name"><Input placeholder="December Peak" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Start date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="End date"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
            <Field label="Multiplier (e.g. 1.25)"><Input type="number" step="0.05" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} /></Field>
          </div>
          <div className="flex items-center justify-between">
            <Checkbox label="Peak season" checked={isPeak} onChange={(e) => setIsPeak(e.target.checked)} />
            <Button disabled={!name || !startDate || !endDate} loading={add.isPending} onClick={() => add.mutate()}><Plus className="size-4" /> Add season</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function PricingClient() {
  const qc = useQueryClient();
  const props = useProperties();
  const [pid, setPid] = usePropertySelection(props.data);
  const [tab, setTab] = useState<"rates" | "holidays" | "promos" | "packages">("rates");
  const [open, setOpen] = useState(false);
  const [seasonRate, setSeasonRate] = useState<Rate | null>(null);
  const [del, setDel] = useState<Rate | null>(null);
  const currency = props.data?.find((p) => p.id === pid)?.currency ?? "LKR";

  const rates = useQuery({ enabled: !!pid, queryKey: ["rates", pid], queryFn: async () => (await api<Rate[]>(`/api/rate-plans?propertyId=${pid}`)).data });
  const cabanas = useQuery({ enabled: !!pid, queryKey: ["cabanas", pid, "", "", false], queryFn: async () => (await api<CabanaOpt[]>(`/api/cabanas?propertyId=${pid}&pageSize=100`)).data });
  const holidays = useQuery({ enabled: !!pid, queryKey: ["holidays", pid], queryFn: async () => (await api<Holiday[]>(`/api/holidays?propertyId=${pid}`)).data });
  const promos = useQuery({ queryKey: ["promos"], queryFn: async () => (await api<Promo[]>("/api/promo-codes")).data });
  const packages = useQuery({ enabled: !!pid, queryKey: ["packages", pid], queryFn: async () => (await api<Pkg[]>(`/api/packages?propertyId=${pid}`)).data });

  const remove = useMutation({
    mutationFn: (r: Rate) => api(`/api/rate-plans?id=${r.id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rates", pid] }); setDel(null); },
  });

  // Inline forms for holidays, promos, packages
  const [hDate, setHDate] = useState(""); const [hName, setHName] = useState("");
  const addHoliday = useMutation({
    mutationFn: () => api("/api/holidays", { method: "POST", body: { propertyId: pid, date: hDate, name: hName } }),
    onSuccess: () => { setHDate(""); setHName(""); qc.invalidateQueries({ queryKey: ["holidays", pid] }); },
  });
  const delHoliday = useMutation({
    mutationFn: (id: string) => api(`/api/holidays?id=${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays", pid] }),
  });

  const [pCode, setPCode] = useState(""); const [pType, setPType] = useState<"PERCENT" | "FIXED">("PERCENT"); const [pVal, setPVal] = useState("10");
  const addPromo = useMutation({
    mutationFn: () => api("/api/promo-codes", { method: "POST", body: { code: pCode, type: pType, value: Number(pVal) } }),
    onSuccess: () => { setPCode(""); qc.invalidateQueries({ queryKey: ["promos"] }); },
  });
  const delPromo = useMutation({
    mutationFn: (id: string) => api(`/api/promo-codes?id=${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promos"] }),
  });

  const [pkgName, setPkgName] = useState(""); const [pkgPrice, setPkgPrice] = useState(""); const [pkgDesc, setPkgDesc] = useState("");
  const addPkg = useMutation({
    mutationFn: () => api("/api/packages", { method: "POST", body: { propertyId: pid, name: pkgName, price: Number(pkgPrice), description: pkgDesc || undefined, inclusions: pkgDesc ? pkgDesc.split(",").map((s) => s.trim()).filter(Boolean) : [] } }),
    onSuccess: () => { setPkgName(""); setPkgPrice(""); setPkgDesc(""); qc.invalidateQueries({ queryKey: ["packages", pid] }); },
  });
  const delPkg = useMutation({
    mutationFn: (id: string) => api(`/api/packages?id=${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["packages", pid] }),
  });

  const activeSeasonRate = rates.data?.find((r) => r.id === seasonRate?.id) ?? seasonRate;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Pricing & Yield Rules</h1>
          <p className="text-sm text-muted">Base rates, seasonal multipliers, public holidays, promo codes and packages.</p>
        </div>
        <div className="flex items-center gap-3">
          {props.data && <PropertySelect props={props.data} value={pid} onChange={setPid} />}
          {tab === "rates" && <Button onClick={() => setOpen(true)} disabled={!pid}><Plus className="size-4" /> Add rate</Button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {([
          { k: "rates", label: "Rate Plans & Seasons", icon: Tag },
          { k: "holidays", label: "Public Holidays", icon: Calendar },
          { k: "promos", label: "Promo Codes", icon: Percent },
          { k: "packages", label: "Packages", icon: Gift },
        ] as const).map((t) => (
          <button
            key={t.k} onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t.k ? "bg-teal text-white" : "text-muted hover:bg-surface-2"}`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "rates" && (
        <>
          {rates.error && <ErrorState message={(rates.error as Error).message} onRetry={() => rates.refetch()} />}
          {rates.isLoading && <Skeleton className="h-48" />}
          {rates.data?.length === 0 && <EmptyState title="No rates configured" text="Cabanas can't be booked until an hourly, day-use or overnight rate exists." action={<Button onClick={() => setOpen(true)}><Plus className="size-4" /> Add rate</Button>} />}
          {!!rates.data?.length && (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-border text-left text-muted"><tr>
                  {["Rate", "Type", "Scope", "Weekday", "Weekend", "Holiday", "Seasons", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {rates.data.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium">{r.name}{r.isCorporate && <Badge tone="purple" className="ml-2">Corp</Badge>}</td>
                      <td className="px-4 py-3"><Badge tone="blue">{KIND_LABEL[r.kind]}</Badge></td>
                      <td className="px-4 py-3 text-muted">{r.cabana ? r.cabana.code : "All cabanas"}</td>
                      <td className="px-4 py-3">{money(r.weekdayRate, currency)}</td>
                      <td className="px-4 py-3">{money(r.weekendRate, currency)}</td>
                      <td className="px-4 py-3">{r.holidayRate ? money(r.holidayRate, currency) : "—"}</td>
                      <td className="px-4 py-3">
                        <Button size="sm" variant="secondary" onClick={() => setSeasonRate(r)}>
                          <Sparkles className="size-3.5" /> {r.seasonalRates.length} season(s)
                        </Button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => { remove.reset(); setDel(r); }} aria-label={`Deactivate ${r.name}`}><Trash2 className="size-3.5" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {tab === "holidays" && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Holiday date"><Input type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} /></Field>
            <Field label="Holiday name" className="min-w-60 flex-1"><Input placeholder="Poya / New Year" value={hName} onChange={(e) => setHName(e.target.value)} /></Field>
            <Button disabled={!hDate || hName.trim().length < 2} loading={addHoliday.isPending} onClick={() => addHoliday.mutate()}><Plus className="size-4" /> Add holiday</Button>
          </div>
          {addHoliday.error && <p role="alert" className="text-sm text-danger">{(addHoliday.error as Error).message}</p>}
          {holidays.data?.length === 0 ? (
            <p className="text-sm text-muted">No public holidays configured for this property.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {holidays.data?.map((h) => (
                <li key={h.id} className="flex items-center justify-between px-4 py-2.5">
                  <span><b>{h.date.slice(0, 10)}</b> · {h.name}</span>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => delHoliday.mutate(h.id)}><Trash2 className="size-3.5" /></Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "promos" && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Promo code"><Input placeholder="SUMMER20" className="uppercase" value={pCode} onChange={(e) => setPCode(e.target.value.toUpperCase())} /></Field>
            <Field label="Discount type"><Select value={pType} onChange={(e) => setPType(e.target.value as "PERCENT" | "FIXED")}><option value="PERCENT">Percentage (%)</option><option value="FIXED">Fixed amount ({currency})</option></Select></Field>
            <Field label="Value"><Input type="number" step="0.01" value={pVal} onChange={(e) => setPVal(e.target.value)} /></Field>
            <Button disabled={pCode.trim().length < 2 || !Number(pVal)} loading={addPromo.isPending} onClick={() => addPromo.mutate()}><Plus className="size-4" /> Create code</Button>
          </div>
          {addPromo.error && <p role="alert" className="text-sm text-danger">{(addPromo.error as Error).message}</p>}
          {promos.data?.length === 0 ? (
            <p className="text-sm text-muted">No promo codes created yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {promos.data?.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">{p.code}</span>
                    <Badge tone={p.isActive ? "green" : "gray"}>{p.type === "PERCENT" ? `${Number(p.value)}% off` : `${money(p.value, currency)} off`}</Badge>
                    <span className="text-xs text-muted">Used {p.usedCount}{p.maxUses ? `/${p.maxUses}` : ""}</span>
                  </div>
                  {p.isActive && <Button size="sm" variant="ghost" className="text-danger" onClick={() => delPromo.mutate(p.id)}><Trash2 className="size-3.5" /></Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "packages" && (
        <Card className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Package name"><Input placeholder="Day Outing + Lunch" value={pkgName} onChange={(e) => setPkgName(e.target.value)} /></Field>
            <Field label={`Price (${currency})`}><Input type="number" step="0.01" value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)} /></Field>
            <Field label="Inclusions (comma-separated)"><Input placeholder="Welcome drink, BBQ lunch, Pool access" value={pkgDesc} onChange={(e) => setPkgDesc(e.target.value)} /></Field>
          </div>
          <Button disabled={pkgName.trim().length < 2 || !pkgPrice} loading={addPkg.isPending} onClick={() => addPkg.mutate()}><Plus className="size-4" /> Add package</Button>
          {packages.data?.length === 0 ? (
            <p className="text-sm text-muted">No packages created yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {packages.data?.map((k) => (
                <div key={k.id} className="flex items-start justify-between rounded-xl border border-border p-4">
                  <div>
                    <h4 className="font-semibold">{k.name}</h4>
                    <p className="text-sm font-medium text-teal">{money(k.price, currency)}</p>
                    {k.description && <p className="mt-1 text-xs text-muted">{k.description}</p>}
                  </div>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => delPkg.mutate(k.id)}><Trash2 className="size-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Add rate" wide><RateForm propertyId={pid} cabanas={cabanas.data ?? []} onDone={() => setOpen(false)} /></Dialog>
      <SeasonModal rate={activeSeasonRate} propertyId={pid} onClose={() => setSeasonRate(null)} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Deactivate rate?" confirmLabel="Deactivate"
        message={`"${del?.name}" will stop applying to new bookings. Existing bookings keep their price.`}
        loading={remove.isPending} error={remove.error instanceof ApiError ? remove.error.message : null} onConfirm={() => del && remove.mutate(del)} />
    </div>
  );
}

void Textarea;
