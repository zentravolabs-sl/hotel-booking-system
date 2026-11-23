"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, ShieldAlert, Sparkles, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { api, ApiError, money } from "@/lib/utils";

interface GuestRow {
  id: string; firstName: string; lastName: string; email: string | null; phone: string | null;
  nationality: string | null; idType: string | null; idNumber: string | null;
  isVip: boolean; isBlacklisted: boolean; blacklistReason: string | null;
  notes: string | null; preferences: string[] | null;
  _count?: { bookings: number };
}
interface GuestDetail extends GuestRow {
  bookings: {
    id: string; reference: string; type: string; status: string; paymentStatus: string;
    startAt: string; endAt: string; total: string;
    property: { name: string; currency: string };
    items: { cabana: { code: string; name: string } }[];
  }[];
}

function GuestFormModal({ open, onClose, guest, canSensitive }: { open: boolean; onClose: () => void; guest?: GuestRow | null; canSensitive: boolean }) {
  const qc = useQueryClient();
  const [firstName, setFirstName] = useState(guest?.firstName ?? "");
  const [lastName, setLastName] = useState(guest?.lastName ?? "");
  const [email, setEmail] = useState(guest?.email ?? "");
  const [phone, setPhone] = useState(guest?.phone ?? "");
  const [nationality, setNationality] = useState(guest?.nationality ?? "Sri Lankan");
  const [idType, setIdType] = useState<"NIC" | "PASSPORT" | "DRIVING_LICENSE">((guest?.idType as "NIC") ?? "NIC");
  const [idNumber, setIdNumber] = useState(guest?.idNumber && !guest.idNumber.includes("•") ? guest.idNumber : "");
  const [isVip, setIsVip] = useState(guest?.isVip ?? false);
  const [isBlacklisted, setIsBlacklisted] = useState(guest?.isBlacklisted ?? false);
  const [blacklistReason, setBlacklistReason] = useState(guest?.blacklistReason ?? "");
  const [prefs, setPrefs] = useState(Array.isArray(guest?.preferences) ? guest!.preferences.join(", ") : "");
  const [notes, setNotes] = useState(guest?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api(guest ? `/api/guests/${guest.id}` : "/api/guests", {
        method: guest ? "PATCH" : "POST",
        body: {
          firstName,
          lastName,
          email: email || null,
          phone: phone || null,
          nationality: nationality || null,
          idType,
          ...(idNumber ? { idNumber } : {}),
          isVip,
          ...(canSensitive ? { isBlacklisted, blacklistReason: isBlacklisted ? blacklistReason || null : null } : {}),
          preferences: prefs.split(",").map((s) => s.trim()).filter(Boolean),
          notes: notes || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guests"] });
      if (guest) qc.invalidateQueries({ queryKey: ["guest", guest.id] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save guest"),
  });

  return (
    <Dialog open={open} onClose={onClose} title={guest ? `Edit Guest · ${guest.firstName} ${guest.lastName}` : "Register Guest"} wide>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950/40">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name *"><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
          <Field label="Last name *"><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Nationality"><Input value={nationality} onChange={(e) => setNationality(e.target.value)} /></Field>
          <Field label="ID Type">
            <Select value={idType} onChange={(e) => setIdType(e.target.value as typeof idType)}>
              <option value="NIC">NIC</option>
              <option value="PASSPORT">Passport</option>
              <option value="DRIVING_LICENSE">Driving License</option>
            </Select>
          </Field>
          <Field label="ID / Passport Number" hint={guest?.idNumber?.includes("•") ? `Current masked: ${guest.idNumber}` : undefined}>
            <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="Leave blank to keep existing" />
          </Field>
          <Field label="Preferences (comma-separated)">
            <Input value={prefs} onChange={(e) => setPrefs(e.target.value)} placeholder="Oceanfront, Vegan, Early check-in" />
          </Field>
        </div>

        <Field label="Guest Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

        <div className="flex flex-wrap gap-6">
          <Checkbox label="VIP Guest" checked={isVip} onChange={(e) => setIsVip(e.target.checked)} />
          {canSensitive && (
            <Checkbox label="Blacklist Guest (blocks future reservations & check-in)" checked={isBlacklisted} onChange={(e) => setIsBlacklisted(e.target.checked)} />
          )}
        </div>

        {canSensitive && isBlacklisted && (
          <Field label="Blacklist reason (authorized personnel only)">
            <Input value={blacklistReason} onChange={(e) => setBlacklistReason(e.target.value)} placeholder="Reason for restriction…" />
          </Field>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!firstName.trim() || !lastName.trim()} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>
            {guest ? "Save Changes" : "Register Guest"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function GuestProfileDrawer({ guestId, canSensitive, onEdit, onClose }: { guestId: string | null; canSensitive: boolean; onEdit: (g: GuestRow) => void; onClose: () => void }) {
  const { data: g, isLoading } = useQuery({
    enabled: !!guestId,
    queryKey: ["guest", guestId],
    queryFn: async () => (await api<GuestDetail>(`/api/guests/${guestId}`)).data,
  });

  if (!guestId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-full bg-teal/10 text-teal"><User className="size-5" /></div>
            <div>
              <h2 className="text-lg font-semibold">{g ? `${g.firstName} ${g.lastName}` : "Guest Profile"}</h2>
              <p className="text-xs text-muted">{g?.nationality ?? "Guest"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {g && <Button size="sm" variant="secondary" onClick={() => onEdit(g)}>Edit Profile</Button>}
            <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface-2"><X className="size-5" /></button>
          </div>
        </div>

        {isLoading && <div className="mt-6 space-y-3"><Skeleton className="h-28" /><Skeleton className="h-44" /></div>}

        {g && (
          <div className="mt-5 space-y-5 text-sm">
            <div className="flex flex-wrap gap-2">
              {g.isVip && <Badge tone="amber"><Sparkles className="mr-1 size-3" />VIP Guest</Badge>}
              {g.isBlacklisted && <Badge tone="red"><ShieldAlert className="mr-1 size-3" />Blacklisted</Badge>}
            </div>

            {g.isBlacklisted && canSensitive && g.blacklistReason && (
              <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-danger dark:border-red-900 dark:bg-red-950/40">
                <b>Blacklist reason:</b> {g.blacklistReason}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border p-4">
              <div><p className="text-xs text-muted">Email</p><p className="font-medium">{g.email || "—"}</p></div>
              <div><p className="text-xs text-muted">Phone</p><p className="font-medium">{g.phone || "—"}</p></div>
              <div><p className="text-xs text-muted">ID Document</p><p className="font-medium">{g.idType || "—"}</p></div>
              <div><p className="text-xs text-muted">ID Number</p><p className="font-mono font-medium">{g.idNumber || "—"}</p></div>
            </div>

            {Array.isArray(g.preferences) && g.preferences.length > 0 && (
              <div>
                <p className="mb-1.5 font-semibold">Preferences</p>
                <div className="flex flex-wrap gap-1.5">{g.preferences.map((p) => <Badge key={p} tone="blue">{p}</Badge>)}</div>
              </div>
            )}

            {g.notes && (
              <div>
                <p className="mb-1 font-semibold">Staff Notes</p>
                <p className="rounded-xl border border-border bg-surface-2/50 p-3 text-muted">{g.notes}</p>
              </div>
            )}

            <div>
              <p className="mb-2 font-semibold">Stay & Booking History ({g.bookings.length})</p>
              {g.bookings.length === 0 ? (
                <p className="text-xs text-muted">No bookings recorded for this guest yet.</p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {g.bookings.map((b) => (
                    <li key={b.id} className="flex items-center justify-between px-4 py-3 text-xs">
                      <div>
                        <p className="font-mono font-semibold">{b.reference} · {b.property.name}</p>
                        <p className="text-muted">
                          {new Date(b.startAt).toLocaleDateString()} → {new Date(b.endAt).toLocaleDateString()} · {b.items.map((i) => i.cabana.code).join(", ")}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge>{b.status}</Badge>
                        <p className="mt-1 font-semibold">{money(b.total, b.property.currency)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export function GuestsClient() {
  const [q, setQ] = useState("");
  const [vipOnly, setVipOnly] = useState(false);
  const [blacklistedOnly, setBlacklistedOnly] = useState(false);
  const [formGuest, setFormGuest] = useState<{ open: boolean; guest?: GuestRow | null }>({ open: false });
  const [profileId, setProfileId] = useState<string | null>(null);

  const guests = useQuery({
    queryKey: ["guests", q, vipOnly, blacklistedOnly],
    queryFn: async () =>
      api<GuestRow[]>(
        `/api/guests?q=${encodeURIComponent(q)}${vipOnly ? "&vip=true" : ""}${blacklistedOnly ? "&blacklisted=true" : ""}`,
      ),
  });

  const canSensitive = Boolean(guests.data?.meta?.canSensitive);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Guest CRM & Profiles</h1>
          <p className="text-sm text-muted">Guest directory, stay history, VIP preferences, ID records and blacklist controls.</p>
        </div>
        <Button onClick={() => setFormGuest({ open: true, guest: null })}><Plus className="size-4" /> Register Guest</Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative min-w-64 flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-3 size-4 text-muted" />
          <Input className="pl-9" placeholder="Search name, email or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Checkbox label="VIP only" checked={vipOnly} onChange={(e) => setVipOnly(e.target.checked)} />
        <Checkbox label="Blacklisted only" checked={blacklistedOnly} onChange={(e) => setBlacklistedOnly(e.target.checked)} />
      </div>

      {guests.error && <ErrorState message={(guests.error as Error).message} onRetry={() => guests.refetch()} />}
      {guests.isLoading && <Skeleton className="h-64" />}
      {guests.data?.data.length === 0 && (
        <EmptyState title="No guests found" text="Register a guest or create a reservation to populate your CRM." />
      )}

      {!!guests.data?.data.length && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                {["Guest", "Contact", "Nationality", "ID Document", "Stays", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guests.data.data.map((g) => (
                <tr key={g.id} className="border-b border-border last:border-0 hover:bg-surface-2/40">
                  <td className="px-4 py-3 font-medium">{g.firstName} {g.lastName}</td>
                  <td className="px-4 py-3 text-xs text-muted">{[g.phone, g.email].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-3">{g.nationality || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{g.idType ? `${g.idType}: ${g.idNumber ?? "—"}` : "—"}</td>
                  <td className="px-4 py-3">{g._count?.bookings ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {g.isVip && <Badge tone="amber">VIP</Badge>}
                      {g.isBlacklisted && <Badge tone="red">Blacklisted</Badge>}
                      {!g.isVip && !g.isBlacklisted && <Badge tone="green">Regular</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="secondary" onClick={() => setProfileId(g.id)}>Profile</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {formGuest.open && (
        <GuestFormModal
          key={formGuest.guest?.id ?? "new"}
          open={formGuest.open}
          onClose={() => setFormGuest({ open: false })}
          guest={formGuest.guest}
          canSensitive={canSensitive}
        />
      )}

      <GuestProfileDrawer
        guestId={profileId}
        canSensitive={canSensitive}
        onEdit={(g) => { setProfileId(null); setFormGuest({ open: true, guest: g }); }}
        onClose={() => setProfileId(null)}
      />
    </div>
  );
}

