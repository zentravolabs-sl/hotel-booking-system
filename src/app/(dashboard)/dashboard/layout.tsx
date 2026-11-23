import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Sidebar, type NavItem } from "@/components/sidebar";

const NAV: (NavItem & { perm: string })[] = [
  { href: "/dashboard", label: "Dashboard", icon: "layout", perm: "" },
  { href: "/dashboard/front-desk", label: "Front Desk", icon: "frontdesk", perm: "booking:frontdesk" },
  { href: "/dashboard/bookings", label: "Bookings & Calendar", icon: "calendar", perm: "booking:read" },
  { href: "/dashboard/guests", label: "Guests CRM", icon: "guests", perm: "guest:read" },
  { href: "/dashboard/housekeeping", label: "Housekeeping & Maint.", icon: "housekeeping", perm: "housekeeping:read" },
  { href: "/dashboard/restaurant", label: "Restaurant & POS", icon: "restaurant", perm: "restaurant:read" },
  { href: "/dashboard/inventory", label: "Inventory & Stock", icon: "inventory", perm: "inventory:read" },
  { href: "/dashboard/staff", label: "Staff & Payroll", icon: "staff", perm: "staff:read" },
  { href: "/dashboard/finance", label: "Finance & Payments", icon: "finance", perm: "finance:read" },
  { href: "/dashboard/reports", label: "Reports & Alerts", icon: "reports", perm: "report:read" },
  { href: "/dashboard/properties", label: "Properties", icon: "building", perm: "property:read" },
  { href: "/dashboard/cabanas", label: "Cabanas", icon: "home", perm: "cabana:read" },
  { href: "/dashboard/pricing", label: "Pricing", icon: "tag", perm: "cabana:read" },
  { href: "/dashboard/subscription", label: "Subscription & Team", icon: "subscription", perm: "org:manage" },
  { href: "/dashboard/super-admin", label: "Super Admin SaaS", icon: "superadmin", perm: "platform:manage" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const perms = new Set(user.role.permissions.map((p) => p.permission.key));
  const items = NAV.filter((n) => !n.perm || perms.has(n.perm)).map(({ perm, ...n }) => (void perm, n));
  return (
    <Sidebar items={items} user={{ name: user.name, role: user.role.name }}>
      {children}
    </Sidebar>
  );
}

