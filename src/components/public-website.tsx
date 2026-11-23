"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BedDouble, Calendar, CheckCircle2, Clock, Compass, CreditCard, Gift, MapPin, Moon,
  Phone, Search, ShieldCheck, Sparkles, Star, Sun, Users, Utensils, Waves, Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { api, ApiError, money } from "@/lib/utils";

interface PublicProperty {
  id: string; name: string; city: string | null; address: string | null; phone: string | null;
  email: string | null; currency: string; timezone: string; description: string | null;
}
interface PublicCabana {
  id: string; code: string; name: string; description: string | null; zone: string | null;
  maxAdults: number; maxChildren: number; hourlyEnabled: boolean; overnightEnabled: boolean; featured: boolean;
  isAvailable: boolean; startingHourlyRate: string | null; startingOvernightRate: string | null;
  type: { name: string } | null;
  images: { id: string; url: string; alt: string | null }[];
  amenities: { amenity: { id: string; name: string } }[];
  quote: {
    subtotal: string; discount: string; serviceCharge: string; tax: string; total: string; deposit: string;
    items: { breakdown: { lines: { description: string; amount: string }[] } }[];
  } | null;
}
interface PublicPackage { id: string; name: string; description: string | null; price: string; inclusions: string[] | null }
interface PublicPromo { code: string; type: "PERCENT" | "FIXED"; value: string; minAmount: string | null }
interface PublicReview { id: string; rating: number; comment: string | null; createdAt: string }

interface CatalogResponse {
  properties: PublicProperty[];
  activeProperty: PublicProperty | null;
  cabanas: PublicCabana[];
  packages: PublicPackage[];
  promos: PublicPromo[];
  reviews: PublicReview[];
}

const isoTomorrow = (offsetDays = 1) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toISOString().slice(0, 10);
};

export function PublicResortWebsite() {
  const [propertyId, setPropertyId] = useState("");
  const [bookingType, setBookingType] = useState<"HOURLY" | "DAY_USE" | "OVERNIGHT" | "MULTI_NIGHT">("OVERNIGHT");
  const [startDate, setStartDate] = useState(() => isoTomorrow(1));
  const [endDate, setEndDate] = useState(() => isoTomorrow(2));
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("15:00");
  const [adults, setAdults] = useState(2);
  const [children] = useState(0);
  const [promoCode, setPromoCode] = useState("");
  const [detailCabana, setDetailCabana] = useState<PublicCabana | null>(null);
  const [checkoutCabana, setCheckoutCabana] = useState<PublicCabana | null>(null);

  const isHourly = bookingType === "HOURLY" || bookingType === "DAY_USE";
  const startAt = useMemo(
    () => (isHourly ? new Date(`${startDate}T${startTime}:00`) : new Date(`${startDate}T14:00:00`)),
    [isHourly, startDate, startTime],
  );
  const endAt = useMemo(
    () => (isHourly ? new Date(`${startDate}T${endTime}:00`) : new Date(`${endDate}T11:00:00`)),
    [isHourly, startDate, endDate, endTime],
  );

  const catalog = useQuery({
    queryKey: ["public_catalog", propertyId, bookingType, startAt.toISOString(), endAt.toISOString(), adults, children, promoCode],
    queryFn: async () =>
      (await api<CatalogResponse>(
        `/api/public/catalog?${propertyId ? `propertyId=${propertyId}&` : ""}type=${bookingType}&startAt=${encodeURIComponent(startAt.toISOString())}&endAt=${encodeURIComponent(endAt.toISOString())}&adults=${adults}&children=${children}${promoCode ? `&promoCode=${encodeURIComponent(promoCode)}` : ""}`,
      )).data,
  });

  const prop = catalog.data?.activeProperty;
  const currency = prop?.currency ?? "LKR";

  // Guest checkout state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [wantAccount, setWantAccount] = useState(false);
  const [password, setPassword] = useState("");
  const [payMode, setPayMode] = useState<"DEPOSIT" | "FULL" | "HOLD_ONLY">("DEPOSIT");
  const [bookErr, setBookErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    reference: string;
    total: string;
    depositRequired: string;
    holdExpiresAt: string | null;
    payhereSession: { actionUrl: string; fields: Record<string, string> } | null;
  } | null>(null);

  const bookMutation = useMutation({
    mutationFn: async () =>
      (await api<{
        booking: { reference: string; total: string; depositRequired: string; holdExpiresAt: string | null };
        payhereSession: { actionUrl: string; fields: Record<string, string> } | null;
      }>("/api/public/book", {
        method: "POST",
        body: {
          propertyId: prop!.id,
          cabanaIds: [checkoutCabana!.id],
          type: bookingType,
          startAt,
          endAt,
          adults,
          children,
          extraBeds: 0,
          promoCode: promoCode || undefined,
          guest: { firstName, lastName, email: email || undefined, phone: phone || undefined },
          specialRequests: specialRequests || undefined,
          ...(wantAccount && password ? { createAccountPassword: password } : {}),
          payMode,
        },
      })).data,
    onSuccess: (res) => {
      setConfirmed({ ...res.booking, payhereSession: res.payhereSession });
      catalog.refetch();
    },
    onError: (e) => setBookErr(e instanceof ApiError ? e.message : "Could not complete reservation"),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-xl font-semibold">
            <Waves className="size-6 text-teal" />
            <span>{prop?.name ?? "CabanaPro Resorts"}</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
            <a href="#cabanas" className="hover:text-teal">Cabanas</a>
            <a href="#facilities" className="hover:text-teal">Facilities</a>
            <a href="#packages" className="hover:text-teal">Packages &amp; Offers</a>
            <a href="#reviews" className="hover:text-teal">Reviews</a>
            <a href="#contact" className="hover:text-teal">Contact &amp; Policies</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/my-bookings" className="rounded-xl border border-border px-3.5 py-2 text-sm font-medium hover:bg-surface-2">
              My Bookings
            </Link>
            <Link href="/dashboard" className="rounded-xl bg-navy px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">
              Staff Portal
            </Link>
          </div>
        </div>
      </header>

      {/* Hero + Availability Search Bar */}
      <section className="relative overflow-hidden bg-navy py-16 text-white sm:py-24">
        <div className="absolute -left-24 -top-24 size-96 rounded-full bg-teal/25 blur-3xl" />
        <div className="absolute -bottom-24 right-0 size-96 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="max-w-2xl space-y-4">
            <Badge tone="green" className="bg-teal/20 text-teal-200">Instant Online Reservation · Hourly &amp; Overnight</Badge>
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
              Private Beachfront Cabanas &amp; Boutique Resort Escapes
            </h1>
            <p className="text-base text-slate-300">
              {prop?.description ??
                "Reserve a private lagoon or oceanfront cabana by the hour, for a day outing, or for a multi-night stay with live availability and instant confirmation."}
            </p>
          </div>

          {/* Search Booking Form */}
          <div className="mt-8 rounded-2xl border border-white/15 bg-surface p-5 text-foreground shadow-2xl">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {(catalog.data?.properties.length ?? 0) > 1 && (
                <Field label="Resort Location">
                  <Select value={propertyId || prop?.id || ""} onChange={(e) => setPropertyId(e.target.value)}>
                    {catalog.data?.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Stay Type">
                <Select value={bookingType} onChange={(e) => setBookingType(e.target.value as typeof bookingType)}>
                  <option value="OVERNIGHT">Overnight Stay</option>
                  <option value="MULTI_NIGHT">Multi-Night Escape</option>
                  <option value="HOURLY">Hourly Cabana</option>
                  <option value="DAY_USE">Day Use Outing</option>
                </Select>
              </Field>

              {isHourly ? (
                <>
                  <Field label="Date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
                  <Field label="Start Time"><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
                  <Field label="End Time"><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
                </>
              ) : (
                <>
                  <Field label="Check-In"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
                  <Field label="Check-Out"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
                </>
              )}

              <Field label="Guests (Adults)">
                <Input type="number" min={1} max={20} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
              </Field>
              <Field label="Promo Code">
                <Input placeholder="Optional" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} />
              </Field>
            </div>
          </div>
        </div>
      </section>

      {/* Cabana Listing & Live Availability */}
      <section id="cabanas" className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Available Cabanas &amp; Villas</h2>
            <p className="text-sm text-muted">
              Real-time availability and all-inclusive pricing for your selected dates ({startDate}{!isHourly ? ` → ${endDate}` : ` · ${startTime}–${endTime}`}).
            </p>
          </div>
        </div>

        {!catalog.data?.cabanas.length ? (
          <div className="mt-6">
            <EmptyState
              title="No cabanas published yet"
              text="Sign in to the Staff Portal to create your resort properties, cabanas and rate plans."
              action={<Link href="/register" className="inline-flex h-10 items-center rounded-xl bg-teal px-4 text-sm font-medium text-white">Launch Resort Workspace</Link>}
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.data.cabanas.map((c) => (
              <Card key={c.id} className="flex flex-col justify-between overflow-hidden">
                <div>
                  <div className="relative h-52 bg-gradient-to-br from-teal/25 to-navy/30">
                    {c.images[0] ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={c.images[0].url} alt={c.name} className="size-full object-cover" />
                    ) : (
                      <div className="grid size-full place-items-center text-teal/70"><BedDouble className="size-12" /></div>
                    )}
                    <div className="absolute left-3 top-3 flex gap-1.5">
                      {c.featured && <Badge tone="amber"><Sparkles className="mr-1 size-3" />Featured</Badge>}
                      {c.type && <Badge tone="blue">{c.type.name}</Badge>}
                    </div>
                    <Badge tone={c.isAvailable ? "green" : "red"} className="absolute right-3 top-3">
                      {c.isAvailable ? "Available" : "Sold Out for Slot"}
                    </Badge>
                  </div>

                  <div className="space-y-3 p-5">
                    <div>
                      <p className="text-xs text-muted">{c.code}{c.zone ? ` · ${c.zone}` : ""}</p>
                      <h3 className="text-lg font-semibold">{c.name}</h3>
                      {c.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{c.description}</p>}
                    </div>

                    <div className="flex flex-wrap gap-3 text-xs text-muted">
                      <span className="flex items-center gap-1"><Users className="size-3.5" />Up to {c.maxAdults} Adults{c.maxChildren ? `, ${c.maxChildren} Children` : ""}</span>
                      {c.hourlyEnabled && <span className="flex items-center gap-1"><Clock className="size-3.5" />Hourly</span>}
                      {c.overnightEnabled && <span className="flex items-center gap-1"><Moon className="size-3.5" />Overnight</span>}
                    </div>

                    {c.amenities.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {c.amenities.slice(0, 5).map((a) => <Badge key={a.amenity.id}>{a.amenity.name}</Badge>)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-border bg-surface-2/40 px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      {c.quote ? (
                        <>
                          <p className="text-xs text-muted">Total for selected stay</p>
                          <p className="text-lg font-bold text-teal">{money(c.quote.total, currency)}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-muted">Starting from</p>
                          <p className="text-base font-semibold">
                            {c.startingOvernightRate
                              ? `${money(c.startingOvernightRate, currency)} / night`
                              : c.startingHourlyRate
                                ? `${money(c.startingHourlyRate, currency)} / hr`
                                : "Contact for rates"}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setDetailCabana(c)}>Details</Button>
                      <Button
                        size="sm"
                        disabled={!c.isAvailable}
                        onClick={() => { setConfirmed(null); setBookErr(null); setCheckoutCabana(c); }}
                      >
                        Book Now
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Resort Facilities */}
      <section id="facilities" className="border-y border-border bg-surface py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h2 className="text-2xl font-semibold">Resort Facilities &amp; Experiences</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Waves, title: "Infinity Lagoon & Plunge Pools", text: "Direct beach and private plunge pool access from beachfront cabanas." },
              { icon: Utensils, title: "Oceanfront Dining & Room Service", text: "Fresh seafood grill, tropical cocktails and direct cabana room service." },
              { icon: Wifi, title: "High-Speed Fiber Wi-Fi", text: "Seamless work-from-cabana connectivity across the entire property." },
              { icon: Compass, title: "Curated Day Outings & Excursions", text: "Flexible hourly and day-use cabana passes with welcome refreshments." },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border border-border p-5">
                <f.icon className="size-7 text-teal" />
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1 text-xs text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Packages & Active Promo Offers */}
      <section id="packages" className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-semibold">Packages &amp; Special Offers</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.data?.packages.map((pkg) => (
            <Card key={pkg.id} className="p-5">
              <div className="flex items-center justify-between">
                <Badge tone="green"><Gift className="mr-1 size-3" />Package</Badge>
                <span className="text-lg font-bold text-teal">{money(pkg.price, currency)}</span>
              </div>
              <h3 className="mt-3 font-semibold">{pkg.name}</h3>
              {pkg.description && <p className="mt-1 text-xs text-muted">{pkg.description}</p>}
            </Card>
          ))}
          {catalog.data?.promos.map((p) => (
            <Card key={p.code} className="border-dashed border-teal/50 p-5">
              <Badge tone="amber">Promo Code: {p.code}</Badge>
              <h3 className="mt-3 font-semibold">
                Save {p.type === "PERCENT" ? `${Number(p.value)}%` : money(p.value, currency)} on your booking
              </h3>
              <p className="mt-1 text-xs text-muted">Enter code <b>{p.code}</b> in the search bar above to apply automatically.</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Guest Testimonials & Reviews */}
      <section id="reviews" className="border-t border-border bg-surface py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h2 className="text-2xl font-semibold">Verified Guest Reviews</h2>
          {catalog.data?.reviews.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Guests can submit verified reviews from the My Bookings portal using their booking reference.</p>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.data?.reviews.map((r) => (
                <Card key={r.id} className="p-5">
                  <div className="flex gap-1 text-amber-500">
                    {Array.from({ length: r.rating }).map((_, i) => <Star key={i} className="size-4 fill-current" />)}
                  </div>
                  <p className="mt-3 text-sm">&ldquo;{r.comment}&rdquo;</p>
                  <p className="mt-2 text-xs text-muted">Verified Guest · {new Date(r.createdAt).toLocaleDateString()}</p>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Contact, Location & Policies Footer */}
      <footer id="contact" className="bg-navy py-12 text-slate-300">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:grid-cols-3 sm:px-6">
          <div>
            <div className="flex items-center gap-2 font-semibold text-white"><Waves className="size-5 text-teal" /> {prop?.name ?? "CabanaPro Resorts"}</div>
            <p className="mt-2 text-xs text-slate-400">
              <MapPin className="mr-1 inline size-3.5" /> {[prop?.address, prop?.city].filter(Boolean).join(", ") || "Southern Coast, Sri Lanka"}
            </p>
            {prop?.phone && <p className="mt-1 text-xs text-slate-400"><Phone className="mr-1 inline size-3.5" /> {prop.phone}</p>}
          </div>
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-white">Guest Policies</p>
            <p>Standard Check-in: 14:00 · Check-out: 11:00</p>
            <p>Temporary online holds expire automatically if unpaid within the hold window.</p>
            <Link href="/policies" className="inline-block text-teal hover:underline">Terms, Privacy &amp; Cancellation Policy →</Link>
          </div>
          <div className="space-y-2 text-xs">
            <p className="font-semibold text-white">Manage Your Reservation</p>
            <p>Look up your booking confirmation, download receipts or leave a review without needing an account.</p>
            <Link href="/my-bookings" className="inline-block rounded-xl bg-teal px-4 py-2 font-medium text-white">Find My Booking</Link>
          </div>
        </div>
      </footer>

      {/* Cabana Detail Modal */}
      <Dialog open={!!detailCabana} onClose={() => setDetailCabana(null)} title={detailCabana?.name ?? "Cabana Details"} wide>
        {detailCabana && (
          <div className="space-y-4 text-sm">
            {detailCabana.images.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {detailCabana.images.map((img) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img key={img.id} src={img.url} alt={img.alt ?? detailCabana.name} className="h-44 w-full rounded-xl object-cover" />
                ))}
              </div>
            )}
            <p className="text-muted">{detailCabana.description || "Private resort cabana with full access to resort facilities."}</p>
            <div className="flex flex-wrap gap-2">
              <Badge tone="blue">Code: {detailCabana.code}</Badge>
              <Badge>Max {detailCabana.maxAdults} Adults, {detailCabana.maxChildren} Children</Badge>
              {detailCabana.zone && <Badge>Zone: {detailCabana.zone}</Badge>}
            </div>
            {detailCabana.amenities.length > 0 && (
              <div>
                <p className="mb-1.5 font-semibold">Amenities</p>
                <div className="flex flex-wrap gap-1.5">
                  {detailCabana.amenities.map((a) => <Badge key={a.amenity.id} tone="green">{a.amenity.name}</Badge>)}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="secondary" onClick={() => setDetailCabana(null)}>Close</Button>
              <Button
                disabled={!detailCabana.isAvailable}
                onClick={() => {
                  const c = detailCabana;
                  setDetailCabana(null);
                  setConfirmed(null);
                  setCheckoutCabana(c);
                }}
              >
                Proceed to Checkout
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Guest Checkout & Booking Confirmation Modal */}
      <Dialog open={!!checkoutCabana} onClose={() => setCheckoutCabana(null)} title={confirmed ? "Booking Reserved!" : `Reserve · ${checkoutCabana?.name ?? ""}`} wide>
        {checkoutCabana && (
          confirmed ? (
            <div className="space-y-4 text-sm">
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
                <div className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-200">
                  <CheckCircle2 className="size-5" /> Reservation Reference: <span className="font-mono">{confirmed.reference}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Total: <b>{money(confirmed.total, currency)}</b> · Deposit Required: <b>{money(confirmed.depositRequired, currency)}</b>
                </p>
                {confirmed.holdExpiresAt && (
                  <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                    Your temporary cabana hold is reserved until <b>{new Date(confirmed.holdExpiresAt).toLocaleTimeString()}</b>. Complete online payment to confirm immediately.
                  </p>
                )}
              </div>

              {confirmed.payhereSession && (
                <form action={confirmed.payhereSession.actionUrl} method="POST" className="rounded-xl border border-border p-4">
                  {Object.entries(confirmed.payhereSession.fields).map(([k, v]) => (
                    <input key={k} type="hidden" name={k} value={v} />
                  ))}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">Pay Online via PayHere (Sri Lanka)</p>
                      <p className="text-xs text-muted">Visa, Mastercard, LankaQR, eZ Cash &amp; Internet Banking</p>
                    </div>
                    <Button type="submit"><CreditCard className="size-4" /> Pay {money(confirmed.payhereSession.fields.amount, currency)}</Button>
                  </div>
                </form>
              )}

              <div className="flex justify-end gap-2">
                <Link href={`/my-bookings?ref=${encodeURIComponent(confirmed.reference)}`} className="inline-flex h-10 items-center rounded-xl bg-teal px-4 text-sm font-medium text-white">
                  View Booking Confirmation
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              {bookErr && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-danger dark:bg-red-950/40">{bookErr}</p>}

              {checkoutCabana.quote && (
                <div className="rounded-xl border border-border bg-surface-2/60 p-4">
                  <p className="font-semibold">Complete Price Breakdown</p>
                  <div className="mt-2 space-y-1 text-xs">
                    {checkoutCabana.quote.items[0]?.breakdown.lines.map((l, i) => (
                      <div key={i} className="flex justify-between"><span>{l.description}</span><span>{money(l.amount, currency)}</span></div>
                    ))}
                    <div className="flex justify-between border-t border-border pt-2 text-sm font-bold">
                      <span>Total</span><span className="text-teal">{money(checkoutCabana.quote.total, currency)}</span>
                    </div>
                    <div className="flex justify-between text-muted">
                      <span>Advance deposit required</span><span>{money(checkoutCabana.quote.deposit, currency)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First name *"><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
                <Field label="Last name *"><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
                <Field label="Email *"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                <Field label="Mobile / WhatsApp *"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
              </div>

              <Field label="Special requests (optional)">
                <Input value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} placeholder="Arrival time, dietary needs, celebration setup…" />
              </Field>

              <Field label="Payment option">
                <Select value={payMode} onChange={(e) => setPayMode(e.target.value as typeof payMode)}>
                  <option value="DEPOSIT">Pay Advance Deposit Online (PayHere)</option>
                  <option value="FULL">Pay Full Amount Online (PayHere)</option>
                  <option value="HOLD_ONLY">Place Temporary Hold &amp; Pay by Bank Transfer / Desk</option>
                </Select>
              </Field>

              <div className="rounded-xl border border-border p-3">
                <Checkbox
                  label="Create an optional customer account to manage all future bookings in one click (not required to book)"
                  checked={wantAccount}
                  onChange={(e) => setWantAccount(e.target.checked)}
                />
                {wantAccount && (
                  <Field label="Choose a password (8+ characters)" className="mt-2">
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border pt-4">
                <span className="flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="size-4 text-teal" /> No account required · Instant hold protection</span>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setCheckoutCabana(null)}>Cancel</Button>
                  <Button
                    disabled={!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()}
                    loading={bookMutation.isPending}
                    onClick={() => { setBookErr(null); bookMutation.mutate(); }}
                  >
                    Complete Reservation
                  </Button>
                </div>
              </div>
            </div>
          )
        )}
      </Dialog>
    </div>
  );
}

void Calendar; void Search; void Sun;

