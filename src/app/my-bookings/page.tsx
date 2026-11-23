"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Printer, Search, Star, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError, money } from "@/lib/utils";

interface LookupBooking {
  id: string; reference: string; type: string; status: string; paymentStatus: string;
  startAt: string; endAt: string; adults: number; children: number;
  subtotal: string; discountTotal: string; serviceChargeTotal: string; taxTotal: string; total: string; paidTotal: string;
  holdExpiresAt: string | null;
  property: { id: string; name: string; city: string | null; phone: string | null; currency: string };
  guest: { firstName: string; lastName: string; email: string | null; phone: string | null };
  items: { cabana: { code: string; name: string; zone: string | null } }[];
}

export default function MyBookingsPage() {
  const [ref, setRef] = useState(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("ref") ?? "" : "",
  );
  const [email, setEmail] = useState("");
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");
  const [reviewRef, setReviewRef] = useState<string | null>(null);
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);

  const lookup = useQuery({
    queryKey: ["my_bookings", ref, email],
    queryFn: async () =>
      (await api<{ bookings: LookupBooking[] }>(
        `/api/public/lookup?${ref ? `ref=${encodeURIComponent(ref)}&` : ""}${email ? `email=${encodeURIComponent(email)}` : ""}`,
      )).data,
  });

  const submitReview = useMutation({
    mutationFn: (reference: string) =>
      api("/api/public/reviews", {
        method: "POST",
        body: { reference, rating: Number(rating), comment },
      }),
    onSuccess: () => {
      setReviewMsg("Thank you! Your review has been published.");
      setComment("");
      setReviewRef(null);
    },
    onError: (e) => setReviewMsg(e instanceof ApiError ? e.message : "Could not submit review"),
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold"><Waves className="size-5 text-teal" /> Back to Resort Website</Link>
          <Link href="/login" className="text-sm font-medium text-teal hover:underline">Sign In</Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold">My Bookings &amp; Confirmation Lookup</h1>
          <p className="text-sm text-muted">Enter your booking reference (e.g. CP-261120-XXXXXX) to view or print your confirmation and leave a review.</p>
        </div>

        <Card className="p-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Booking Reference" className="min-w-56 flex-1">
              <Input placeholder="CP-XXXXXX-XXXXXX" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} />
            </Field>
            <Field label="Email or Phone (optional verification)" className="min-w-56 flex-1">
              <Input placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button onClick={() => lookup.refetch()}><Search className="size-4" /> Find Booking</Button>
          </div>
        </Card>

        {reviewMsg && <p className="rounded-xl bg-teal/10 px-4 py-2.5 text-sm font-medium text-teal">{reviewMsg}</p>}

        {lookup.data?.bookings.length === 0 ? (
          <EmptyState title="No bookings displayed" text="Enter your booking reference above or sign in to view your reservation history." />
        ) : (
          <div className="space-y-4">
            {lookup.data?.bookings.map((b) => (
              <Card key={b.id} className="space-y-4 p-6 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-4">
                  <div>
                    <p className="font-mono text-xs text-muted">Reference: {b.reference}</p>
                    <h2 className="text-lg font-semibold">{b.property.name}</h2>
                    <p className="text-xs text-muted">Guest: {b.guest.firstName} {b.guest.lastName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={b.status === "CONFIRMED" || b.status === "CHECKED_OUT" ? "green" : "amber"}>{b.status}</Badge>
                    <Badge tone={b.paymentStatus === "PAID" ? "green" : "amber"}>{b.paymentStatus}</Badge>
                    <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer className="size-3.5" /> Print Confirmation</Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div><p className="text-xs text-muted">Check-In / Start</p><p className="font-medium">{new Date(b.startAt).toLocaleString()}</p></div>
                  <div><p className="text-xs text-muted">Check-Out / End</p><p className="font-medium">{new Date(b.endAt).toLocaleString()}</p></div>
                  <div><p className="text-xs text-muted">Cabana(s)</p><p className="font-medium">{b.items.map((i) => `${i.cabana.code} (${i.cabana.name})`).join(", ")}</p></div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2/60 p-4">
                  <div>
                    <span>Total: <b>{money(b.total, b.property.currency)}</b></span> ·{" "}
                    <span>Paid: <b>{money(b.paidTotal, b.property.currency)}</b></span> ·{" "}
                    <span>Balance: <b>{money(Number(b.total) - Number(b.paidTotal), b.property.currency)}</b></span>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setReviewRef(b.reference)}>
                    <Star className="size-3.5" /> Write a Review
                  </Button>
                </div>

                {reviewRef === b.reference && (
                  <div className="space-y-3 rounded-xl border border-border p-4">
                    <div className="flex items-end gap-3">
                      <Field label="Rating">
                        <Select value={rating} onChange={(e) => setRating(e.target.value)} className="w-28">
                          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} Stars</option>)}
                        </Select>
                      </Field>
                      <Field label="Your experience" className="flex-1">
                        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share how your cabana stay was…" />
                      </Field>
                      <Button disabled={comment.trim().length < 3} loading={submitReview.isPending} onClick={() => submitReview.mutate(b.reference)}>
                        Publish Review
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

