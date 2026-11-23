# CabanaPro – Database Architecture & Integrity Guide

## 1. Multi-Tenant Data Model

Every tenant-scoped table (`Property`, `Cabana`, `RatePlan`, `Guest`, `Booking`, `BookingItem`, `Payment`, `Refund`, `Invoice`, `Expense`, `CashRegisterClosing`, `CleaningTask`, `MaintenanceRequest`, `FoodOrder`, `Product`, `StockTransaction`, `Employee`, `Notification`, `AuditLog`) carries an indexed `organizationId` column.

- **Server-Side Tenant Resolution**: `requireAuth()` and `requirePermission()` in `src/lib/auth/context.ts` load the authenticated user's `organizationId` directly from the database session—client-supplied `organizationId` fields are never trusted.
- **No Cross-Tenant Leakage**: Property and cabana loaders (`assertPropertyAccess`, `loadCabana`) filter by `{ id, organizationId }` and return HTTP `404 Not Found` (rather than `403`) for foreign IDs so resource existence is never leaked across tenants.

## 2. Concurrent Double-Booking Prevention (PostgreSQL Exclusion Constraint)

In addition to application-level availability queries, the database migration (`prisma/migrations/20261120000000_init/migration.sql`) installs the `btree_gist` extension and enforces a hard exclusion constraint on `BookingItem`:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "BookingItem" ADD CONSTRAINT booking_item_valid_range CHECK ("endAt" > "startAt");

ALTER TABLE "BookingItem" ADD CONSTRAINT booking_item_no_overlap
  EXCLUDE USING gist ("cabanaId" WITH =, tsrange("startAt", "endAt", '[)') WITH &&)
  WHERE ("blocking");
```

- **Turnaround Buffer Included**: `BookingItem.endAt` stores the guest's departure time **plus** the property's `turnaroundMinutes` cleaning buffer.
- **Half-Open Intervals `[startAt, endAt)`**: Back-to-back bookings where Booking B starts at the exact buffered end of Booking A are permitted; any overlapping interval is rejected by PostgreSQL with SQLSTATE `23P01` even under 10+ simultaneous transactions.
- **Temporary Holds & Release**: `PENDING` website holds have `blocking = true` and `holdExpiresAt`. When a booking is cancelled, marked `NO_SHOW`, checked out, or its hold expires (`expireStaleHolds`), `blocking` is set to `false` so the slot is immediately freed while preserving historical records.

## 3. Operational Status vs. Reservation Status

- `Cabana.status` (`AVAILABLE`, `RESERVED`, `OCCUPIED`, `CLEANING`, `MAINTENANCE`, `INACTIVE`) is stored independently from `Booking.status`.
- Cancelling a booking releases `BookingItem.blocking`, but **never** flips a `MAINTENANCE` or `DIRTY` cabana to `AVAILABLE`.
- Checking out a guest transitions the cabana to `CLEANING` (`cleaningStatus = DIRTY`) and creates a `CleaningTask`. The cabana only returns to `AVAILABLE` after cleaning and required inspection (`inspectCleaningTask`).

## 4. Financial Precision & Immutable Stock Ledger

- All monetary columns use `@db.Decimal(12, 2)` and all calculations use `Prisma.Decimal` with `ROUND_HALF_UP`.
- `StockTransaction` is guarded by a PostgreSQL `BEFORE UPDATE OR DELETE` trigger (`stock_tx_immutable`) that raises an exception on any mutation attempt, guaranteeing an auditable append-only inventory history.

