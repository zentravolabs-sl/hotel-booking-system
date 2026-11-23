"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, MapPin, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/card";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { useProperties, type PropertyDTO } from "@/components/property-select";
import { api, ApiError } from "@/lib/utils";

const TIMEZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Asia/Colombo"];

const schema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(100),
  description: z.string().max(2000),
  address: z.string().max(200),
  city: z.string().max(80),
  phone: z.string().max(30),
  email: z.string().refine((v) => !v || z.string().email().safeParse(v).success, "Invalid email"),
  timezone: z.string().min(1),
  currency: z.string().length(3, "3-letter code"),
  isPublic: z.boolean(),
});
type V = z.infer<typeof schema>;

const strip = (v: V) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ""));

function PropertyForm({ p, onDone }: { p?: PropertyDTO; onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: p?.name ?? "", description: p?.description ?? "", address: p?.address ?? "", city: p?.city ?? "", phone: p?.phone ?? "",
      email: p?.email ?? "", timezone: p?.timezone ?? "Asia/Colombo", currency: p?.currency ?? "LKR", isPublic: p?.isPublic ?? true,
    },
  });
  const m = useMutation({
    mutationFn: (v: V) => api(p ? `/api/properties/${p.id}` : "/api/properties", { method: p ? "PATCH" : "POST", body: strip(v) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["properties"] }); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  return (
    <form onSubmit={handleSubmit((v) => { setError(null); m.mutate(v); })} className="space-y-4" noValidate>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950/40">{error}</p>}
      <Field label="Property name" error={errors.name?.message}><Input {...register("name")} /></Field>
      <Field label="Description" error={errors.description?.message}><Textarea {...register("description")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Address"><Input {...register("address")} /></Field>
        <Field label="City"><Input {...register("city")} /></Field>
        <Field label="Phone"><Input {...register("phone")} /></Field>
        <Field label="Email" error={errors.email?.message}><Input type="email" {...register("email")} /></Field>
        <Field label="Timezone" hint="Booking times are interpreted in this zone"><Select {...register("timezone")}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Currency" error={errors.currency?.message}><Input maxLength={3} className="uppercase" {...register("currency", { setValueAs: (v) => String(v).toUpperCase() })} /></Field>
      </div>
      <Checkbox label="Show on the public booking website" {...register("isPublic")} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={m.isPending}>{p ? "Save changes" : "Create property"}</Button>
      </div>
    </form>
  );
}

const num = (min: number, max: number) => z.number({ error: "Enter a number" }).min(min).max(max);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const sSchema = z.object({
  checkInTime: hhmm, checkOutTime: hhmm,
  turnaroundMinutes: num(0, 240).int(), holdMinutes: num(5, 120).int(), minHours: num(1, 24).int(),
  taxPercent: num(0, 100), serviceChargePercent: num(0, 100), depositPercent: num(0, 100),
  requireInspection: z.boolean(),
});
type S = z.infer<typeof sSchema>;

function SettingsForm({ p, onDone }: { p: PropertyDTO; onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const s = p.settings;
  const { register, handleSubmit, formState: { errors } } = useForm<S>({
    resolver: zodResolver(sSchema),
    defaultValues: {
      checkInTime: s?.checkInTime ?? "14:00", checkOutTime: s?.checkOutTime ?? "11:00", turnaroundMinutes: s?.turnaroundMinutes ?? 30,
      holdMinutes: s?.holdMinutes ?? 15, minHours: s?.minHours ?? 1, taxPercent: Number(s?.taxPercent ?? 0),
      serviceChargePercent: Number(s?.serviceChargePercent ?? 0), depositPercent: Number(s?.depositPercent ?? 30), requireInspection: s?.requireInspection ?? true,
    },
  });
  const m = useMutation({
    mutationFn: (v: S) => api(`/api/properties/${p.id}`, { method: "PATCH", body: { settings: v } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["properties"] }); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  const n = (k: keyof S) => register(k, { valueAsNumber: true });
  return (
    <form onSubmit={handleSubmit((v) => { setError(null); m.mutate(v); })} className="space-y-4" noValidate>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950/40">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Check-in time" error={errors.checkInTime?.message}><Input type="time" {...register("checkInTime")} /></Field>
        <Field label="Check-out time" error={errors.checkOutTime?.message}><Input type="time" {...register("checkOutTime")} /></Field>
        <Field label="Turnaround buffer (min)" hint="Cabana is blocked this long after each stay" error={errors.turnaroundMinutes?.message}><Input type="number" {...n("turnaroundMinutes")} /></Field>
        <Field label="Booking hold (min)" hint="How long unpaid website bookings hold a cabana" error={errors.holdMinutes?.message}><Input type="number" {...n("holdMinutes")} /></Field>
        <Field label="Minimum hourly booking (h)" error={errors.minHours?.message}><Input type="number" {...n("minHours")} /></Field>
        <Field label="Deposit %" error={errors.depositPercent?.message}><Input type="number" step="0.01" {...n("depositPercent")} /></Field>
        <Field label="Service charge %" error={errors.serviceChargePercent?.message}><Input type="number" step="0.01" {...n("serviceChargePercent")} /></Field>
        <Field label="Tax %" error={errors.taxPercent?.message}><Input type="number" step="0.01" {...n("taxPercent")} /></Field>
      </div>
      <Checkbox label="Require inspection before a cleaned cabana becomes available" {...register("requireInspection")} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={m.isPending}>Save settings</Button>
      </div>
    </form>
  );
}

export function PropertiesClient() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useProperties();
  const [dlg, setDlg] = useState<{ kind: "edit" | "settings" | "delete"; p?: PropertyDTO } | null>(null);
  const close = () => setDlg(null);
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/properties/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["properties"] }); close(); },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Properties</h1><p className="text-sm text-muted">Resorts, branches and locations in your organization.</p></div>
        <Button onClick={() => setDlg({ kind: "edit" })}><Plus className="size-4" /> Add property</Button>
      </div>

      {error && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}
      {isLoading && <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-44" />)}</div>}
      {data && data.length === 0 && <EmptyState title="No properties yet" text="Add your first property to start creating cabanas." action={<Button onClick={() => setDlg({ kind: "edit" })}><Plus className="size-4" /> Add property</Button>} />}

      <div className="grid gap-4 md:grid-cols-2">
        {data?.map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3">
                <div className="grid size-11 place-items-center rounded-xl bg-teal/10 text-teal"><Building2 className="size-5" /></div>
                <div>
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="flex items-center gap-1 text-sm text-muted"><MapPin className="size-3.5" />{[p.city, p.timezone].filter(Boolean).join(" · ")}</p>
                </div>
              </div>
              <Badge tone={p.isPublic ? "green" : "gray"}>{p.isPublic ? "Public" : "Hidden"}</Badge>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-muted">Cabanas</dt><dd className="font-semibold">{p.cabanaCount}</dd></div>
              <div><dt className="text-muted">Check-in</dt><dd className="font-semibold">{p.settings?.checkInTime}</dd></div>
              <div><dt className="text-muted">Check-out</dt><dd className="font-semibold">{p.settings?.checkOutTime}</dd></div>
            </dl>
            <div className="mt-4 flex gap-2 border-t border-border pt-4">
              <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "edit", p })}><Pencil className="size-3.5" /> Edit</Button>
              <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "settings", p })}><Settings2 className="size-3.5" /> Settings</Button>
              <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={() => { del.reset(); setDlg({ kind: "delete", p }); }}><Trash2 className="size-3.5" /> Archive</Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={dlg?.kind === "edit"} onClose={close} title={dlg?.p ? "Edit property" : "Add property"} wide><PropertyForm p={dlg?.p} onDone={close} /></Dialog>
      <Dialog open={dlg?.kind === "settings"} onClose={close} title={`Booking settings · ${dlg?.p?.name ?? ""}`}>{dlg?.p && <SettingsForm p={dlg.p} onDone={close} />}</Dialog>
      <ConfirmDialog
        open={dlg?.kind === "delete"} onClose={close} title="Archive property?" confirmLabel="Archive"
        message={`"${dlg?.p?.name}" will be hidden from your dashboard and website. Properties with active bookings cannot be archived.`}
        loading={del.isPending} error={del.error instanceof ApiError ? del.error.message : null}
        onConfirm={() => dlg?.p && del.mutate(dlg.p.id)}
      />
    </div>
  );
}

