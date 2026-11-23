# CabanaPro – Production Deployment & Operations Guide

## 1. Production Build & Verification

Before deploying, run all verification steps:

```bash
npx prisma validate
npx prisma migrate deploy
npm run typecheck
npm run lint
npm test
npm run build
```

## 2. Environment & Secrets Protection

- Set `NODE_ENV=production`.
- Use a strong 48+ byte `SESSION_SECRET` (`openssl rand -base64 48`). Session cookies (`cp_session`) are automatically flagged `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Configure `DATABASE_URL` with Neon's pooled connection string (`-pooler`) for serverless concurrency and `DIRECT_URL` with the direct connection string for migrations.
- Set `PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET`, and `PAYHERE_SANDBOX=false` for live Sri Lanka PayHere payments, and configure PayHere's webhook `notify_url` to `https://<your-domain>/api/payments/payhere/webhook`.
- Never prefix server secrets with `NEXT_PUBLIC_`.

## 3. Scheduled Background Jobs (Cron)

Schedule an HTTP `POST` every 5 minutes (via Vercel Cron, GitHub Actions, or system `crontab`) to:

```text
POST https://<your-domain>/api/jobs/run
```

This endpoint idempotently:
1. Releases expired `PENDING` website booking holds (`holdExpiresAt < now`) so cabanas become available again.
2. Purges expired sessions and one-time auth tokens.
3. Transitions overdue trials/subscriptions past `currentPeriodEnd` to `EXPIRED` and dispatches `SUBSCRIPTION_EXPIRY` notifications.

## 4. Security Hardening & Data Backup Strategy

- **HTTP Security Headers**: Configured in `next.config.ts` (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`).
- **CSRF & Origin Protection**: All mutating endpoints verify `assertSameOrigin(req)` in addition to `SameSite=Lax` cookies.
- **Database Backups**: Enable Neon Point-in-Time Recovery (PITR) with a minimum 7–30 day restore window, and schedule daily logical backups (`pg_dump --format=custom`) to encrypted object storage.

