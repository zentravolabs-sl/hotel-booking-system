"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Archive, BedDouble, Clock, History, ImagePlus, Moon, Pencil, Plus, RotateCcw, Search, Sparkles, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, Skeleton, STATUS_TONE } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { PropertySelect, useProperties, usePropertySelection } from "@/components/property-select";
import { api, ApiError } from "@/lib/utils";

interface Amenity { id: string; name: string }
interface CabanaType { id: string; name: string }
interface CabanaRow {
  id: string; propertyId: string; code: string; name: string; description: string | null; zone: string | null;
  maxAdults: number; maxChildren: number; status: string; cleaningStatus: string; hourlyEnabled: boolean; overnightEnabled: boolean;
  featured: boolean; archivedAt: string | null; typeId: string | null; type: CabanaType | null;
  bedConfig: { type: string; count: number }[] | null;
  images: { id: string; url: string }[]; amenities: { amenity: Amenity }[];
}
interface CabanaDetail extends CabanaRow {
  images: { id: string; url: string; alt: string | null }[];
  history: { id: string; fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string }[];
}

const STATUSES = ["AVAILABLE", "CLEANING", "MAINTENANCE", "INACTIVE"] as const;
const BEDS = ["King", "Queen", "Double", "Single", "Bunk", "Sofa bed"];

const int = (min: number, max: number) => z.number({ error: "Enter a number" }).int().min(min).max(max);
const schema = z.object({
  code: z.string().trim().min(1, "Required").max(20).regex(/^[A-Za-z0-9-_]+$/, "Letters, numbers, - and _ only"),
  name: z.string().trim().min(2, "At least 2 characters").max(100),
  typeId: z.string(),
  zone: z.string().max(60),
  description: z.string().max(3000),
  maxAdults: int(1, 30),
  maxChildren: int(0, 30),
  hourlyEnabled: z.boolean(),
  overnightEnabled: z.boolean(),
  featured: z.boolean(),
  amenityIds: z.array(z.string()),
  beds: z.array(z.object({ type: z.string(), count: int(1, 10) })).max(6),
}).refine((v) => v.hourlyEnabled || v.overnightEnabled, { message: "Enable hourly and/or overnight", path: ["overnightEnabled"] });
type V = z.infer<typeof schema>;

function ImagesEditor({ cabanaId }: { cabanaId: string }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["cabana", cabanaId], queryFn: async () => (await api<CabanaDetail>(`/api/cabanas/${cabanaId}`)).data });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["cabana", cabanaId] }); qc.invalidateQueries({ queryKey: ["cabanas"] }); };
  const add = useMutation({
    mutationFn: () => api(`/api/cabanas/${cabanaId}/images`, { method: "POST", body: { url } }),
    onSuccess: () => { setUrl(""); setErr(null); refresh(); },
    onError: (e) => setErr(e instanceof ApiError ? (e.fields?.url?.[0] ?? e.message) : "Could not add image"),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/cabanas/${cabanaId}/images?imageId=${id}`, { method: "DELETE" }), onSuccess: refresh });
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Photos</p>
      <div className="flex flex-wrap gap-3">
        {data?.images.map((i) => (
          <div key={i.id} className="group relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.url} alt={i.alt ?? ""} className="size-20 rounded-xl object-cover" />
            <button type="button" onClick={() => remove.mutate(i.id)} aria-label="Remove photo" className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-danger text-white shadow"><X className="size-3.5" /></button>
          </div>
        ))}
        {data?.images.length === 0 && <p className="text-sm text-muted">No photos yet.</p>}
      </div>
      <div className="flex gap-2">
        <Input placeholder="https://… image URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button type="button" variant="secondary" disabled={!url} loading={add.isPending} onClick={() => add.mutate()}><ImagePlus className="size-4" /> Add</Button>
      </div>
      {err && <p role="alert" className="text-xs font-medium text-danger">{err}</p>}
    </div>
  );
}

function CabanaForm({ propertyId, cabana, types, amenities, onDone }: { propertyId: string; cabana?: CabanaRow; types: CabanaType[]; amenities: Amenity[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [newType, setNewType] = useState("");
  const [newAmenity, setNewAmenity] = useState("");
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: cabana?.code ?? "", name: cabana?.name ?? "", typeId: cabana?.typeId ?? "", zone: cabana?.zone ?? "", description: cabana?.description ?? "",
      maxAdults: cabana?.maxAdults ?? 2, maxChildren: cabana?.maxChildren ?? 0, hourlyEnabled: cabana?.hourlyEnabled ?? true,
      overnightEnabled: cabana?.overnightEnabled ?? true, featured: cabana?.featured ?? false,
      amenityIds: cabana?.amenities.map((a) => a.amenity.id) ?? [], beds: cabana?.bedConfig ?? [],
    },
  });
  const selected = watch("amenityIds");
  const beds = watch("beds");

  const save = useMutation({
    mutationFn: ({ beds, typeId, ...v }: V) => {
      const body = { ...v, typeId: typeId || null, bedConfig: beds, ...(cabana ? {} : { propertyId }) };
      return api(cabana ? `/api/cabanas/${cabana.id}` : "/api/cabanas", { method: cabana ? "PATCH" : "POST", body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cabanas"] }); qc.invalidateQueries({ queryKey: ["cabana"] }); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save cabana"),
  });
  const addType = useMutation({
    mutationFn: () => api<CabanaType>("/api/cabana-types", { method: "POST", body: { propertyId, name: newType } }),
    onSuccess: ({ data }) => { qc.invalidateQueries({ queryKey: ["types", propertyId] }); setValue("typeId", data.id); setNewType(""); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not add category"),
  });
  const addAmenity = useMutation({
    mutationFn: () => api<Amenity>("/api/amenities", { method: "POST", body: { name: newAmenity } }),
    onSuccess: ({ data }) => { qc.invalidateQueries({ queryKey: ["amenities"] }); setValue("amenityIds", [...selected, data.id]); setNewAmenity(""); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not add amenity"),
  });
  const toggle = (id: string) => setValue("amenityIds", selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <form onSubmit={handleSubmit((v) => { setError(null); save.mutate(v); })} className="space-y-5" noValidate>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950/40">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" error={errors.code?.message}><Input placeholder="C-01" {...register("code")} /></Field>
        <Field label="Name" error={errors.name?.message} className="sm:col-span-2"><Input placeholder="Lagoon Cabana" {...register("name")} /></Field>
        <Field label="Category">
          <Select {...register("typeId")}><option value="">None</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        </Field>
        <Field label="Zone / location"><Input placeholder="Beachfront" {...register("zone")} /></Field>
        <Field label="New category">
          <div className="flex gap-1.5"><Input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="e.g. Deluxe" />
            <Button type="button" variant="secondary" disabled={newType.trim().length < 2} loading={addType.isPending} onClick={() => addType.mutate()} aria-label="Add category"><Plus className="size-4" /></Button></div>
        </Field>
        <Field label="Max adults" error={errors.maxAdults?.message}><Input type="number" {...register("maxAdults", { valueAsNumber: true })} /></Field>
        <Field label="Max children" error={errors.maxChildren?.message}><Input type="number" {...register("maxChildren", { valueAsNumber: true })} /></Field>
      </div>
      <Field label="Description"><Textarea {...register("description")} /></Field>

      <div>
        <p className="mb-2 text-sm font-medium">Bed configuration</p>
        <div className="space-y-2">
          {beds.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={b.type} onChange={(e) => setValue("beds", beds.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} className="w-40">{BEDS.map((t) => <option key={t}>{t}</option>)}</Select>
              <Input type="number" min={1} max={10} value={b.count} onChange={(e) => setValue("beds", beds.map((x, j) => (j === i ? { ...x, count: Number(e.target.value) } : x)))} className="w-20" aria-label="Count" />
              <button type="button" aria-label="Remove bed" onClick={() => setValue("beds", beds.filter((_, j) => j !== i))} className="rounded-lg p-2 text-muted hover:bg-surface-2"><Trash2 className="size-4" /></button>
            </div>
          ))}
          {beds.length < 6 && <Button type="button" size="sm" variant="secondary" onClick={() => setValue("beds", [...beds, { type: "Queen", count: 1 }])}><Plus className="size-3.5" /> Add bed</Button>}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Amenities</p>
        <div className="flex flex-wrap gap-2">
          {amenities.map((a) => (
            <button type="button" key={a.id} onClick={() => toggle(a.id)} aria-pressed={selected.includes(a.id)}
              className={`rounded-full border px-3 py-1 text-sm transition ${selected.includes(a.id) ? "border-teal bg-teal/10 text-teal" : "border-border text-muted hover:bg-surface-2"}`}>{a.name}</button>
          ))}
          {amenities.length === 0 && <p className="text-sm text-muted">No amenities yet — add one below.</p>}
        </div>
        <div className="mt-2 flex max-w-sm gap-2">
          <Input value={newAmenity} onChange={(e) => setNewAmenity(e.target.value)} placeholder="New amenity (e.g. Private pool)" />
          <Button type="button" variant="secondary" disabled={newAmenity.trim().length < 2} loading={addAmenity.isPending} onClick={() => addAmenity.mutate()} aria-label="Add amenity"><Plus className="size-4" /></Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox label="Hourly bookings" {...register("hourlyEnabled")} />
        <Checkbox label="Overnight bookings" {...register("overnightEnabled")} />
        <Checkbox label="Featured on website" {...register("featured")} />
      </div>
      {errors.overnightEnabled && <p role="alert" className="text-xs font-medium text-danger">{errors.overnightEnabled.message}</p>}

      {cabana ? <ImagesEditor cabanaId={cabana.id} /> : <p className="text-xs text-muted">You can add photos after creating the cabana.</p>}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>{cabana ? "Save changes" : "Create cabana"}</Button>
      </div>
    </form>
  );
}

function StatusDialog({ cabana, onClose }: { cabana: CabanaRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("MAINTENANCE");
  const [reason, setReason] = useState("");
  const [warn, setWarn] = useState<string | null>(null);
  const { data } = useQuery({ enabled: !!cabana, queryKey: ["cabana", cabana?.id], queryFn: async () => (await api<CabanaDetail>(`/api/cabanas/${cabana!.id}`)).data });
  const m = useMutation({
    mutationFn: () => api(`/api/cabanas/${cabana!.id}/status`, { method: "POST", body: { status, reason: reason || undefined } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["cabanas"] }); qc.invalidateQueries({ queryKey: ["cabana", cabana!.id] });
      if (r.meta?.warning) setWarn(r.meta.warning); else onClose();
    },
  });
  return (
    <Dialog open={!!cabana} onClose={() => { setWarn(null); m.reset(); onClose(); }} title={`Operational status · ${cabana?.code ?? ""}`}>
      <p className="mb-4 text-sm text-muted">Operational status is separate from reservations. Cancelling a booking never changes it.</p>
      <div className="mb-4 flex items-center gap-2 text-sm">Currently <Badge tone={STATUS_TONE[cabana?.status ?? "AVAILABLE"]}>{cabana?.status}</Badge></div>
      {warn ? (
        <div className="space-y-4"><p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{warn}</p><Button onClick={() => { setWarn(null); onClose(); }}>Got it</Button></div>
      ) : (
        <div className="space-y-4">
          <Field label="New status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
          {m.error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950/40">{(m.error as Error).message}</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Update status</Button></div>
        </div>
      )}
      {data && data.history.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><History className="size-4" /> Status history</p>
          <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
            {data.history.map((h) => (
              <li key={h.id} className="flex justify-between gap-3 text-muted">
                <span>{h.fromStatus ? `${h.fromStatus} → ` : ""}<b className="text-foreground">{h.toStatus}</b>{h.reason ? ` — ${h.reason}` : ""}</span>
                <time className="shrink-0">{new Date(h.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

export function CabanasClient() {
  const qc = useQueryClient();
  const props = useProperties();
  const [pid, setPid] = usePropertySelection(props.data);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState(false);
  const [dlg, setDlg] = useState<{ kind: "form" | "status" | "archive"; c?: CabanaRow } | null>(null);
  const close = () => setDlg(null);

  const cabanas = useQuery({
    enabled: !!pid, queryKey: ["cabanas", pid, q, status, archived],
    queryFn: async () => (await api<CabanaRow[]>(`/api/cabanas?propertyId=${pid}&archived=${archived}&q=${encodeURIComponent(q)}${status ? `&status=${status}` : ""}`)).data,
  });
  const types = useQuery({ enabled: !!pid, queryKey: ["types", pid], queryFn: async () => (await api<CabanaType[]>(`/api/cabana-types?propertyId=${pid}`)).data });
  const amenities = useQuery({ queryKey: ["amenities"], queryFn: async () => (await api<Amenity[]>("/api/amenities")).data });

  const archive = useMutation({
    mutationFn: (c: CabanaRow) => api(`/api/cabanas/${c.id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cabanas"] }); close(); },
  });
  const restore = useMutation({
    mutationFn: (c: CabanaRow) => api(`/api/cabanas/${c.id}`, { method: "POST", body: { restore: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cabanas"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Cabanas</h1><p className="text-sm text-muted">Inventory, capacity, amenities and operational status.</p></div>
        <div className="flex items-center gap-3">
          {props.data && <PropertySelect props={props.data} value={pid} onChange={setPid} />}
          <Button onClick={() => setDlg({ kind: "form" })} disabled={!pid}><Plus className="size-4" /> Add cabana</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1 sm:max-w-xs"><Search className="absolute left-3 top-3 size-4 text-muted" /><Input className="pl-9" placeholder="Search name or code" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter"><option value="">All statuses</option>{["AVAILABLE", "RESERVED", "OCCUPIED", "CLEANING", "MAINTENANCE", "INACTIVE"].map((s) => <option key={s}>{s}</option>)}</Select>
        <Checkbox label="Show archived" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
      </div>

      {(props.error || cabanas.error) && <ErrorState message={((props.error || cabanas.error) as Error).message} onRetry={() => cabanas.refetch()} />}
      {(props.isLoading || cabanas.isLoading) && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)}</div>}
      {props.data?.length === 0 && <EmptyState title="Create a property first" text="Cabanas belong to a property." />}
      {cabanas.data?.length === 0 && (
        <EmptyState title={archived ? "No archived cabanas" : q || status ? "No cabanas match your filters" : "No cabanas yet"} text={q || status || archived ? "Try changing the filters." : "Add your first cabana, then set its pricing."}
          action={!q && !status && !archived ? <Button onClick={() => setDlg({ kind: "form" })}><Plus className="size-4" /> Add cabana</Button> : undefined} />
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cabanas.data?.map((c) => (
          <Card key={c.id} className="overflow-hidden">
            <div className="relative h-40 bg-gradient-to-br from-teal/20 to-navy/20">
              {c.images[0] ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.images[0].url} alt={c.name} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-teal/60"><BedDouble className="size-10" /></div>}
              <Badge tone={STATUS_TONE[c.status]} className="absolute right-3 top-3 shadow">{c.status}</Badge>
              {c.featured && <Badge tone="amber" className="absolute left-3 top-3 gap-1 shadow"><Sparkles className="size-3" />Featured</Badge>}
            </div>
            <div className="space-y-3 p-4">
              <div><p className="text-xs font-medium text-muted">{c.code}{c.type ? ` · ${c.type.name}` : ""}{c.zone ? ` · ${c.zone}` : ""}</p><h3 className="font-semibold">{c.name}</h3></div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <span className="flex items-center gap-1"><Users className="size-4" />{c.maxAdults}A{c.maxChildren ? ` + ${c.maxChildren}C` : ""}</span>
                {c.hourlyEnabled && <span className="flex items-center gap-1"><Clock className="size-4" />Hourly</span>}
                {c.overnightEnabled && <span className="flex items-center gap-1"><Moon className="size-4" />Overnight</span>}
              </div>
              {c.amenities.length > 0 && <div className="flex flex-wrap gap-1">{c.amenities.slice(0, 4).map((a) => <Badge key={a.amenity.id}>{a.amenity.name}</Badge>)}{c.amenities.length > 4 && <Badge>+{c.amenities.length - 4}</Badge>}</div>}
              <div className="flex gap-2 border-t border-border pt-3">
                {c.archivedAt ? (
                  <Button size="sm" variant="secondary" loading={restore.isPending} onClick={() => restore.mutate(c)}><RotateCcw className="size-3.5" /> Restore</Button>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "form", c })}><Pencil className="size-3.5" /> Edit</Button>
                    <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "status", c })}>Status</Button>
                    <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={() => { archive.reset(); setDlg({ kind: "archive", c }); }} aria-label="Archive cabana"><Archive className="size-3.5" /></Button>
                  </>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={dlg?.kind === "form"} onClose={close} title={dlg?.c ? `Edit ${dlg.c.code}` : "Add cabana"} wide>
        <CabanaForm key={dlg?.c?.id ?? "new"} propertyId={pid} cabana={dlg?.c} types={types.data ?? []} amenities={amenities.data ?? []} onDone={close} />
      </Dialog>
      <StatusDialog cabana={dlg?.kind === "status" ? dlg.c ?? null : null} onClose={close} />
      <ConfirmDialog
        open={dlg?.kind === "archive"} onClose={close} title="Archive cabana?" confirmLabel="Archive"
        message={`"${dlg?.c?.name}" will no longer be bookable. Cabanas with upcoming bookings can't be archived. You can restore it later.`}
        loading={archive.isPending} error={archive.error instanceof ApiError ? archive.error.message : null} onConfirm={() => dlg?.c && archive.mutate(dlg.c)}
      />
    </div>
  );
}
