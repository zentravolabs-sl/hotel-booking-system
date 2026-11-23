import { db } from "@/lib/db";
import { expireStaleHolds } from "@/modules/bookings/service";
import { dispatchNotification } from "@/modules/notifications/service";

/**
 * Background scheduled job processor:
 * 1. Releases expired temporary booking holds (`PENDING` past `holdExpiresAt` -> `EXPIRED`, `blocking = false`).
 * 2. Purges expired user sessions and consumed/expired auth tokens.
 * 3. Marks overdue `TRIALING` or `ACTIVE` subscriptions past `currentPeriodEnd` as `EXPIRED` and dispatches expiry alerts.
 */
export async function runScheduledMaintenanceJobs(now = new Date()) {
  const expiredHolds = await expireStaleHolds(db, now);

  const [deletedSessions, deletedTokens, dueSubs] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.authToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.subscription.findMany({
      where: {
        status: { in: ["TRIALING", "ACTIVE"] },
        currentPeriodEnd: { lt: now },
      },
    }),
  ]);

  for (const s of dueSubs) {
    await db.subscription.update({ where: { id: s.id }, data: { status: "EXPIRED" } });
    await dispatchNotification({
      organizationId: s.organizationId,
      event: "SUBSCRIPTION_EXPIRY",
      channels: ["IN_APP", "EMAIL"],
      variables: { expiryDate: s.currentPeriodEnd.toISOString().slice(0, 10) },
    });
  }

  return {
    ranAt: now.toISOString(),
    expiredHolds,
    purgedSessions: deletedSessions.count,
    purgedTokens: deletedTokens.count,
    expiredSubscriptions: dueSubs.length,
  };
}

