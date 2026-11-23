# CabanaPro – Multi-Tenant Cabana & Resort Management SaaS

CabanaPro is a production-ready, multi-tenant SaaS platform built for cabana operators, beach resorts, boutique villas, and accommodation businesses. It combines a public customer booking website with 9 operational role workspaces, hourly and overnight reservation engines, dynamic yield pricing, PayHere online payments, Front Desk, Housekeeping, Restaurant POS & Kitchen Display, Immutable Inventory, Staff/Payroll, Finance P&L, Recharts Analytics, and a Super Admin SaaS console.

## Technology Stack

- **Framework**: Next.js 16 (App Router) · React 19 · TypeScript (strict mode)
- **Styling & UI**: Tailwind CSS v4 (Deep Navy `#0E132E` + Tropical Teal `#0D9488`, Light/Dark themes, Inter & Poppins typography, Lucide React icons)
- **Database & ORM**: PostgreSQL (Neon) · Prisma 6 ORM · `btree_gist` exclusion constraints & PL/pgSQL immutability triggers
- **Validation & Forms**: Zod + React Hook Form + TanStack Query
- **Analytics**: Recharts

## Architecture & Module Map

| Area | Route / Module | Highlights |
|---|---|---|
| **Customer Website** | `/`, `/my-bookings`, `/policies` | Real-time availability search, hourly/day-use/overnight quotes, guest checkout without requiring an account + optional registration, PayHere checkout handoff, review portal |
| **Overview Dashboard** | `/dashboard` | Live property, cabana, today's arrivals/departures/bookings & revenue KPIs |
| **Front Desk** | `/dashboard/front-desk` | Today's arrivals, departures, in-house guests, check-in/check-out modals, ID verification, offline payment collection & printable receipts |
| **Bookings & Calendar** | `/dashboard/bookings` | 14-day multi-night availability matrix, 07:00–21:00 hourly timeline, multi-cabana reservation modal with live price preview, Booking Detail Drawer |
| **Guests CRM** | `/dashboard/guests` | Guest directory, stay history, VIP flags, preferences, masked NIC/Passport privacy (`guest:sensitive`) & blacklist controls |
| **Housekeeping & Maint.** | `/dashboard/housekeeping` | Auto-created post-checkout cleaning tasks, 4-point checklists, strict inspector approval gate (`requireInspection`), lost & found, maintenance tickets |
| **Restaurant & POS** | `/dashboard/restaurant` | Menu builder, tables, Dine-in / Takeaway / Cabana Room Service POS, Kitchen Display (KDS), validated room-charging to `CHECKED_IN` folios |
| **Inventory & Stock** | `/dashboard/inventory` | SKUs, kitchen ingredients, suppliers, purchase orders, low-stock alerts, weighted average valuation & trigger-enforced immutable stock ledger |
| **Staff & Payroll** | `/dashboard/staff` | Employee registry, departments, daily clock-in/out, leave approvals & permission-gated payroll liability (`payroll:read`) |
| **Finance & Payments** | `/dashboard/finance` | Non-double-counted accrued P&L vs. treasury cash flow, payment ledger, refunds (`EXCEEDS_PAID` ceiling), expenses, invoices & daily cash register closing |
| **Reports & Alerts** | `/dashboard/reports` | Recharts trends/occupancy/source charts, CSV/Excel/PDF exports across 6 tabular reports, Email/SMS/WhatsApp Business notification templates & history |
| **Subscription & Team** | `/dashboard/subscription` | SaaS plan upgrade/downgrade (`USAGE_EXCEEDS_PLAN` guard), usage progress bars, subscription invoices, user invitations & custom granular RBAC roles |
| **Super Admin SaaS** | `/dashboard/super-admin` | Platform KPIs, tenant suspension/reactivation, SaaS plan catalog editor, subscription revenue ledger & global audit logs |

## Documentation Index

- [SETUP.md](./SETUP.md) — Environment variables, installation, database migration & seeding
- [DATABASE.md](./DATABASE.md) — Schema design, exclusion constraints, triggers & tenant isolation
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) — REST endpoints, authentication, permissions & webhook contracts
- [USER_GUIDE.md](./USER_GUIDE.md) — Operational workflows for each resort role
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Production deployment, security headers, cron jobs & backup strategy
 