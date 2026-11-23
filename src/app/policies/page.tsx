import Link from "next/link";
import { Waves } from "lucide-react";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Terms, Privacy & Cancellation Policy" };

export default function PoliciesPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold"><Waves className="size-5 text-teal" /> Back to Resort Website</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="text-3xl font-semibold">Terms, Privacy &amp; Cancellation Policies</h1>
        <Card className="space-y-3 p-6 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold">1. Reservation Holds &amp; Confirmation</h2>
          <p className="text-muted">
            Online reservations place an immediate time-limited hold on the selected cabana(s) so no other guest can double-book your slot. Once the required deposit or full payment is verified via PayHere or at the Front Desk, the reservation transitions to CONFIRMED.
          </p>
          <h2 className="pt-3 text-lg font-semibold">2. Cancellation &amp; Refund Policy</h2>
          <p className="text-muted">
            Cancellation fees are calculated automatically according to each property&apos;s notice tiers (hours before scheduled check-in). If your paid amount exceeds the applicable cancellation fee, the remaining balance is queued for refund automatically.
          </p>
          <h2 className="pt-3 text-lg font-semibold">3. Guest Data &amp; Privacy Policy</h2>
          <p className="text-muted">
            Guest identification details (NIC / Passport) collected at check-in are encrypted in transit, isolated to the resort tenant, and masked in staff views unless specific sensitive-data permissions are granted.
          </p>
        </Card>
      </main>
    </div>
  );
}

