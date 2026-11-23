# CabanaPro – REST API Documentation

All API responses use a standardized JSON envelope:

```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "pageSize": 20, "total": 42 }
}
```

Errors return HTTP `400`, `401`, `402`, `403`, `404`, `409`, `422`, `423`, or `429` with:

```json
{
  "success": false,
  "error": { "code": "SLOT_TAKEN", "message": "One of the selected cabanas is no longer available for that time." }
}
```

## 1. Authentication & Security

| Method & Path | Permission | Description |
|---|---|---|
| `POST /api/auth/register` | Public (Rate-limited) | Register a new tenant organization, first property, owner account & 14-day trial |
| `POST /api/auth/login` | Public (Rate-limited) | Authenticate email/password with constant-time compare & 8-attempt lockout |
| `POST /api/auth/logout` | Session | Revoke active session and clear `cp_session` HttpOnly cookie |
| `GET /api/auth/security` | Session | Current user profile & 2FA status |
| `POST /api/auth/security` | Public / Session | `request_password_reset`, `confirm_password_reset`, `verify_email`, `update_profile`, `configure_2fa` |

## 2. Properties, Cabanas & Dynamic Yield Pricing

| Method & Path | Permission | Description |
|---|---|---|
| `GET / POST /api/properties` | `property:read` / `property:manage` | List or create properties (enforces plan `maxProperties`) |
| `GET / PATCH / DELETE /api/properties/[id]` | `property:read` / `property:manage` | Property details, booking settings (`turnaroundMinutes`, `holdMinutes`, `requireInspection`), archive |
| `GET / POST /api/cabanas` | `cabana:read` / `cabana:manage` | List cabanas (with search, status filter, pagination) or create cabana |
| `GET / PATCH / DELETE / POST /api/cabanas/[id]` | `cabana:read` / `cabana:manage` | Cabana details, update, archive (refused if active bookings exist), restore |
| `POST /api/cabanas/[id]/status` | `cabana:manage` | Transition operational status (`AVAILABLE`, `CLEANING`, `MAINTENANCE`, `INACTIVE`) with audit history |
| `POST / DELETE /api/cabanas/[id]/images` | `cabana:manage` | Manage cabana photo gallery |
| `GET / POST /api/cabana-types` | `cabana:read` / `cabana:manage` | Manage property cabana categories |
| `GET / POST / DELETE /api/amenities` | `cabana:read` / `cabana:manage` | Manage organization amenities |
| `GET / POST / DELETE /api/rate-plans` | `cabana:read` / `pricing:manage` | Hourly, Day-Use & Overnight rate plans (property-default or cabana-specific) |
| `POST / DELETE /api/seasonal-rates` | `pricing:manage` | Seasonal multipliers & peak-season rules |
| `GET / POST / DELETE /api/holidays` | `cabana:read` / `pricing:manage` | Property public holiday dates |
| `GET / POST / DELETE /api/promo-codes` | `cabana:read` / `pricing:manage` | Percentage & fixed discount promo codes |
| `GET / POST / DELETE /api/packages` | `cabana:read` / `pricing:manage` | Resort packages & inclusions |

## 3. Bookings, Front Desk & Guest CRM

| Method & Path | Permission | Description |
|---|---|---|
| `GET / POST /api/bookings` | `booking:read` / `booking:create` | Search/filter bookings or create multi-cabana reservation |
| `POST /api/bookings/quote` | `booking:read` | Compute live itemised price breakdown without creating a hold |
| `GET /api/bookings/availability` | `booking:read` | Timeline feed of cabanas + occupied intervals (`mode=timeline` or `mode=free`) |
| `GET / PATCH / DELETE /api/bookings/[id]` | `booking:read` / `booking:modify` | Booking details, date/guest modification with repricing, or cancellation with policy fee |
| `POST /api/bookings/[id]/charges` | `booking:modify` | Append folio charges (`EXTRA_GUEST`, `EXTRA_BED`, `EARLY_CHECKIN`, `LATE_CHECKOUT`, `SERVICE`) |
| `POST /api/bookings/[id]/checkin` | `booking:frontdesk` | Check in guest, verify ID, mark cabanas `OCCUPIED` |
| `POST /api/bookings/[id]/checkout` | `booking:frontdesk` | Check out guest, mark cabanas `CLEANING (DIRTY)`, auto-create `CleaningTask` |
| `GET / POST /api/frontdesk` | `booking:read` / `payment:collect` | Today's arrivals/departures/in-house feed & quick offline payment collection |
| `GET / POST /api/guests` | `guest:read` / `guest:manage` | Guest CRM directory (masks NIC/Passport unless caller has `guest:sensitive`) |
| `GET / PATCH /api/guests/[id]` | `guest:read` / `guest:manage` | Guest profile, stay history & blacklist controls (`guest:sensitive`) |

## 4. Payments, Finance, Operations, POS, Inventory, Reports & SaaS

| Method & Path | Permission | Description |
|---|---|---|
| `GET / POST /api/payments` | `payment:read` / `payment:collect` | Payment ledger, offline payments & PayHere checkout session generation |
| `POST /api/payments/payhere/webhook` | PayHere MD5 Signature | Server-to-server PayHere callback verification & idempotent reconciliation |
| `GET / POST /api/refunds` | `payment:read` / `payment:refund` | Refund ledger & refund issuance (`EXCEEDS_PAID` guard) |
| `GET / POST /api/invoices` | `finance:read` / `payment:collect` | Issue or list numbered booking invoices |
| `GET / POST / DELETE /api/expenses` | `finance:read` / `finance:manage` | Operating expense categories & expenses |
| `GET / POST /api/finance` | `finance:read` / `finance:manage` | Non-double-counted P&L summary & daily cash register closing |
| `GET / POST / PATCH /api/housekeeping` | `housekeeping:read` / `manage` / `inspect` | Cleaning tasks, checklists, inspector approval gate & lost-and-found |
| `GET / POST / PATCH /api/maintenance` | `cabana:read` / `maintenance:manage` | Maintenance tickets, cabana locking & completion sign-off |
| `GET / POST / PATCH /api/restaurant` | `restaurant:read` / `order` / `manage` / `kitchen:manage` | Menus, tables, POS orders (with `CHECKED_IN` room-charge validation) & KDS |
| `GET / POST /api/inventory` | `inventory:read` / `inventory:manage` | Products, suppliers, purchase orders & immutable stock transactions |
| `GET / POST /api/staff` | `staff:read` / `staff:manage` / `payroll:read` | Employees, attendance clock-in/out, leaves & restricted payroll summary |
| `GET /api/reports` | `report:read` | KPIs, Recharts series & 6 exportable tabular reports |
| `GET / POST /api/notifications` | Session | Notification templates (`IN_APP`, `EMAIL`, `SMS`, `WHATSAPP`) & delivery history |
| `GET / POST /api/subscription` | `org:manage` / `subscription:manage` | Tenant plan usage, upgrade/downgrade & subscription invoices |
| `GET / POST /api/users` | `user:read` / `user:manage` / `role:manage` | Invite staff, suspend accounts & create custom granular roles |
| `GET / POST /api/super-admin` | `platform:manage` (`SUPER_ADMIN`) | Global SaaS metrics, tenant suspension, plan catalog & audit logs |
| `GET / POST /api/public/catalog` · `/book` · `/lookup` · `/reviews` | Public | Customer website availability catalog, guest checkout, reference lookup & reviews |
| `POST /api/jobs/run` | Cron | Expire stale booking holds, purge expired sessions/tokens & expire overdue subscriptions |

