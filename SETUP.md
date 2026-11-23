# CabanaPro – Local & Development Setup Guide

## Prerequisites

- **Node.js** 20.11+ and **npm** 10+
- **PostgreSQL 15+** (or a Neon Serverless Postgres database with `btree_gist` support)

## 1. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Required variables in `.env`:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Pooled PostgreSQL connection string (`?sslmode=require`) |
| `DIRECT_URL` | Direct (non-pooled) PostgreSQL connection string used by Prisma Migrate |
| `SESSION_SECRET` | Random 48+ byte secret (`openssl rand -base64 48`) |
| `APP_URL` | Base URL of the application (`http://localhost:3000` in development) |
| `PAYHERE_MERCHANT_ID` | PayHere Sri Lanka Merchant ID (`SANDBOX_MERCHANT` for testing) |
| `PAYHERE_MERCHANT_SECRET` | PayHere Merchant Secret used for MD5 checkout hash & webhook `md5sig` verification |

## 2. Install Dependencies & Apply Migrations

```bash
npm install
npx prisma migrate deploy
npx prisma generate
```

## 3. Seed System Roles, Permissions & SaaS Plans

```bash
SEED_SUPERADMIN_EMAIL="superadmin@cabanapro.com" SEED_SUPERADMIN_PASSWORD="ChangeMe123!" npm run db:seed
```

This seeds:
- All **38 granular permissions** (`org:manage`, `booking:frontdesk`, `guest:sensitive`, `payroll:read`, `platform:manage`, etc.)
- All **13 system roles** (`SUPER_ADMIN`, `OWNER`, `GENERAL_MANAGER`, `PROPERTY_ADMIN`, `RECEPTIONIST`, `ACCOUNTANT`, `HOUSEKEEPING`, `RESTAURANT_MANAGER`, `WAITER`, `KITCHEN_STAFF`, `STORE_KEEPER`, `MAINTENANCE`, `CUSTOMER`)
- Default **SaaS Subscription Plans** (`starter`, `growth`, `enterprise`)
- The optional **Super Admin** account if `SEED_SUPERADMIN_EMAIL` and `SEED_SUPERADMIN_PASSWORD` are supplied.

## 4. Run Development Server & Verification Suite

```bash
npm run dev          # Starts Next.js on http://localhost:3000
npm run typecheck    # Runs tsc --noEmit
npm run lint         # Runs ESLint
npm test             # Runs all Vitest unit & real-database integration tests
npm run build        # Verifies production build
```

