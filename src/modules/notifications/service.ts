import { db } from "@/lib/db";

export const NOTIFICATION_EVENTS = [
  "NEW_BOOKING",
  "BOOKING_CONFIRMATION",
  "PAYMENT_SUCCESS",
  "PAYMENT_FAILURE",
  "BOOKING_CANCELLATION",
  "UPCOMING_CHECKIN",
  "UPCOMING_CHECKOUT",
  "PAYMENT_DUE",
  "CLEANING_TASK_ASSIGNED",
  "MAINTENANCE_REQUEST",
  "SUBSCRIPTION_EXPIRY",
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number];

const DEFAULT_TEMPLATES: Record<NotificationEventKey, { subject: string; body: string }> = {
  NEW_BOOKING: {
    subject: "New Booking Received · {{reference}}",
    body: "Hello {{guestName}}, your reservation request {{reference}} at {{propertyName}} has been placed.",
  },
  BOOKING_CONFIRMATION: {
    subject: "Booking Confirmed · {{reference}}",
    body: "Dear {{guestName}}, your cabana reservation {{reference}} at {{propertyName}} is CONFIRMED.",
  },
  PAYMENT_SUCCESS: {
    subject: "Payment Receipt · {{reference}}",
    body: "We have received your payment of {{amount}} for reservation {{reference}}. Thank you!",
  },
  PAYMENT_FAILURE: {
    subject: "Payment Unsuccessful · {{reference}}",
    body: "Your payment attempt for {{reference}} could not be completed. Please retry to keep your hold active.",
  },
  BOOKING_CANCELLATION: {
    subject: "Booking Cancelled · {{reference}}",
    body: "Reservation {{reference}} has been cancelled. Reason: {{reason}}.",
  },
  UPCOMING_CHECKIN: {
    subject: "Reminder: Upcoming Check-In · {{reference}}",
    body: "We look forward to welcoming you to {{propertyName}} for reservation {{reference}}.",
  },
  UPCOMING_CHECKOUT: {
    subject: "Upcoming Check-Out Reminder · {{reference}}",
    body: "Friendly reminder that check-out for {{reference}} is scheduled soon.",
  },
  PAYMENT_DUE: {
    subject: "Balance Due · {{reference}}",
    body: "An outstanding balance of {{amount}} is due for reservation {{reference}}.",
  },
  CLEANING_TASK_ASSIGNED: {
    subject: "Cleaning Task Assigned · {{cabanaCode}}",
    body: "Cabana {{cabanaCode}} has been queued for housekeeping cleaning.",
  },
  MAINTENANCE_REQUEST: {
    subject: "Maintenance Ticket Logged · {{title}}",
    body: "Maintenance request '{{title}}' has been opened for {{cabanaCode}}.",
  },
  SUBSCRIPTION_EXPIRY: {
    subject: "CabanaPro Subscription Expiry Alert",
    body: "Your organization's subscription or trial period ends on {{expiryDate}}.",
  },
};

export function interpolateTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
}

/**
 * Dispatch a notification across one or more channels (`IN_APP`, `EMAIL`, `SMS`, `WHATSAPP`).
 * - Resolves tenant-specific `NotificationTemplate` or falls back to `DEFAULT_TEMPLATES`.
 * - Records immutable delivery history in `Notification`.
 */
export async function dispatchNotification(params: {
  organizationId: string;
  userId?: string | null;
  event: NotificationEventKey;
  channels: ("IN_APP" | "EMAIL" | "SMS" | "WHATSAPP")[];
  variables: Record<string, string>;
}) {
  const custom = await db.notificationTemplate.findMany({
    where: { organizationId: params.organizationId, event: params.event },
  });
  const byChannel = new Map(custom.map((t) => [t.channel, t]));
  const fallback = DEFAULT_TEMPLATES[params.event];

  const created = [];
  for (const ch of params.channels) {
    const tpl = byChannel.get(ch);
    const subject = interpolateTemplate(tpl?.subject ?? fallback.subject, params.variables);
    const body = interpolateTemplate(tpl?.body ?? fallback.body, params.variables);
    const row = await db.notification.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId ?? null,
        channel: ch,
        event: params.event,
        subject,
        body,
        status: "SENT",
      },
    });
    created.push(row);
  }
  return created;
}

