"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import {
  BarChart3, Boxes, Building2, CalendarDays, ConciergeBell, CreditCard, ExternalLink,
  Home, LayoutDashboard, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen,
  ShieldCheck, Sparkles, Sun, Tag, UserCheck, Users, UtensilsCrossed, Wallet, Waves, X,
} from "lucide-react";
import { cn, api } from "@/lib/utils";

const ICONS = {
  layout: LayoutDashboard,
  frontdesk: ConciergeBell,
  calendar: CalendarDays,
  guests: Users,
  housekeeping: Sparkles,
  restaurant: UtensilsCrossed,
  inventory: Boxes,
  staff: UserCheck,
  finance: Wallet,
  reports: BarChart3,
  building: Building2,
  home: Home,
  tag: Tag,
  subscription: CreditCard,
  superadmin: ShieldCheck,
};

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

export function Sidebar({
  items,
  user,
  children,
}: {
  items: NavItem[];
  user: { name: string; role: string };
  children: React.ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  const nav = (
    <nav
      className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3 [scrollbar-width:thin]"
      aria-label="Main"
    >
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = it.href === "/dashboard" ? path === it.href : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            onClick={() => setOpen(false)}
            title={collapsed ? it.label : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
              active
                ? "bg-teal text-white shadow-sm"
                : "text-slate-300 hover:bg-white/10 hover:text-white",
              collapsed && "justify-center px-2",
            )}
          >
            <Icon className="size-4.5 shrink-0" />
            {!collapsed && <span className="truncate">{it.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div
      className={cn(
        "flex h-16 shrink-0 items-center gap-2.5 border-b border-white/10 px-5 font-[family-name:var(--font-heading)] text-lg font-semibold text-white",
        collapsed && "justify-center px-0",
      )}
    >
      <Waves className="size-6 shrink-0 text-teal" />
      {!collapsed && <span>CabanaPro</span>}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop fixed/sticky full-height dark navy sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col bg-navy text-white transition-[width] duration-200 lg:flex",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        {brand}
        {nav}
        <div className="shrink-0 border-t border-white/10 p-2.5">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white"
            aria-label="Toggle sidebar"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4.5" />
            ) : (
              <>
                <PanelLeftClose className="size-4.5" />
                <span>Collapse Menu</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile slide-over drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-xs" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex h-dvh w-64 flex-col bg-navy text-white shadow-2xl">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10">
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
          <button
            className="rounded-lg p-2 hover:bg-surface-2 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>

          <Link
            href="/"
            target="_blank"
            className="hidden items-center gap-1.5 rounded-xl border border-border bg-surface-2/60 px-3 py-1.5 text-xs font-medium text-muted transition hover:border-teal hover:text-teal sm:inline-flex"
          >
            <ExternalLink className="size-3.5" /> Public Booking Website
          </Link>

          <div className="flex-1" />

          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="rounded-lg p-2 text-muted hover:bg-surface-2"
            aria-label="Toggle theme"
            title="Switch light/dark theme"
          >
            <Sun className="hidden size-5 dark:block" />
            <Moon className="size-5 dark:hidden" />
          </button>

          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold leading-tight">{user.name}</p>
            <p className="text-xs text-muted">{user.role}</p>
          </div>

          <button
            onClick={logout}
            className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-5" />
          </button>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
