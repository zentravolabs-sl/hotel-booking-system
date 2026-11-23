import { Waves } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-teal/30 blur-3xl" />
        <div className="relative flex items-center gap-2 font-[family-name:var(--font-heading)] text-xl font-semibold">
          <Waves className="size-6 text-teal" /> CabanaPro
        </div>
        <div className="relative">
          <h1 className="text-4xl font-semibold leading-tight">Run every cabana, booking and guest from one place.</h1>
          <p className="mt-4 max-w-md text-slate-300">Hourly and overnight reservations, live availability and tenant-isolated data for resorts of any size.</p>
        </div>
        <p className="relative text-sm text-slate-400">© CabanaPro</p>
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

