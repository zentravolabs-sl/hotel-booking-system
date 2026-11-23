# CabanaPro – User & Role Operations Guide

## 1. Organization Owner & Property Admin
1. **Onboarding**: Register at `/register` to create your organization, first property, and 14-day trial.
2. **Configure Property Settings**: Open **Properties → Settings** to set check-in/out times, turnaround cleaning buffer (minutes), website hold duration, tax %, service charge %, deposit %, and whether housekeeping inspection is required before a cleaned cabana becomes available.
3. **Add Cabanas & Yield Pricing**:
   - In **Cabanas**, create your cabanas with capacity, bed configurations, amenities, and photos.
   - In **Pricing**, configure Base Rate Plans (`HOURLY`, `DAY_USE`, `OVERNIGHT`), Seasonal Multipliers, Public Holidays, Promo Codes, and Packages.
4. **Team & Subscription**: In **Subscription & Team**, monitor usage against plan limits, upgrade/downgrade plans, invite staff assigned to specific properties, or create custom roles.

## 2. Front Desk Receptionist
1. **Arrivals & Walk-Ins**: Open **Front Desk** (`/dashboard/front-desk`) or **Bookings & Calendar** (`/dashboard/bookings`). Click any free slot on the 14-day calendar or hourly timeline to create a walk-in or phone booking with a live price breakdown.
2. **Check-In**: Click **Check-In** on an arriving booking, record the guest's NIC/Passport number, and optionally add an early check-in fee. The cabana automatically transitions to `OCCUPIED`.
3. **Payment Collection & Folio Charges**: Click **Collect Payment** to record Cash, Card (POS terminal), or Bank Transfer payments and print a numbered receipt (`RCP-...`).
4. **Check-Out**: Click **Check-Out** on a departing guest. Once the folio balance is settled (or overridden to city ledger), the cabana automatically moves to `CLEANING (DIRTY)` and a high-priority cleaning task is dispatched to Housekeeping.

## 3. Housekeeping & Maintenance
1. **Cleaning Workflow**: Open **Housekeeping & Maint.** (`/dashboard/housekeeping`). Complete the checklist items on a `DIRTY` task and click **Mark Clean**.
2. **Supervisor Inspection Gate**: When `requireInspection` is enabled, a supervisor with `housekeeping:inspect` clicks **Approve Inspection & Release Cabana** to move the cabana from `CLEANING` to `AVAILABLE` (or **Reject** to return it to `DIRTY`).
3. **Maintenance Tickets**: Log repair tickets under the **Maintenance & Repairs** tab. Checking "Immediately place cabana into MAINTENANCE" blocks the cabana from new bookings until the repair is marked **Approved**.

## 4. Restaurant Manager, Waiter & Kitchen Staff
1. **POS Terminal**: Open **Restaurant & POS** (`/dashboard/restaurant`), tap menu items to build an order, and choose `Dine-In`, `Takeaway`, or `Cabana Room Service`.
2. **Room Charging**: Selecting **Cabana Room Service** (or checking "Charge bill to an in-house guest cabana folio") lets you pick from currently `CHECKED_IN` guests and posts the bill directly to their booking folio.
3. **Kitchen Display (KDS)**: Switch to the **Kitchen Display (KDS)** tab to advance tickets through `PENDING` → `ACCEPTED` → `PREPARING` → `READY` → `SERVED`.

## 5. Store Keeper & Accountant
1. **Inventory**: Open **Inventory & Stock** (`/dashboard/inventory`) to create product/ingredient SKUs, record stock movements (`RECEIVE`, `ISSUE`, `ADJUSTMENT`, `TRANSFER`), track low-stock alerts, and issue purchase orders.
2. **Finance & Daily Closing**: Open **Finance & Payments** (`/dashboard/finance`) to review accrued P&L, process partial/full refunds, log operating expenses, and run **Daily Cash Closing** reconciliation.
3. **Reports**: Open **Reports & Alerts** (`/dashboard/reports`) to view Recharts analytics, export CSV/Excel/PDF reports, and customize Email/SMS/WhatsApp notification templates.

