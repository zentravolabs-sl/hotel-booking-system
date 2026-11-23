import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { requireAuth } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody } from "@/lib/http";
import { dispatchNotification, NOTIFICATION_EVENTS } from "@/modules/notifications/service";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await requireAuth();
  if (!ctx.organizationId) return ok({ notifications: [], templates: [] });

  const [notifications, templates] = await Promise.all([
    db.notification.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    db.notificationTemplate.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ event: "asc" }, { channel: "asc" }],
    }),
  ]);

  return ok({ notifications, templates, events: NOTIFICATION_EVENTS });
});

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("dispatch"),
    event: z.enum(NOTIFICATION_EVENTS),
    channels: z.array(z.enum(["IN_APP", "EMAIL", "SMS", "WHATSAPP"])).min(1),
    variables: z.record(z.string(), z.string()).default({}),
  }),
  z.object({
    action: z.literal("template"),
    event: z.enum(NOTIFICATION_EVENTS),
    channel: z.enum(["IN_APP", "EMAIL", "SMS", "WHATSAPP"]),
    subject: z.string().trim().max(150).optional(),
    body: z.string().trim().min(3).max(2000),
  }),
  z.object({
    action: z.literal("mark_read"),
    id: z.string().min(1),
  }),
]);

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireAuth();
  if (!ctx.organizationId) return ok({ skipped: true });
  const body = await parseBody(req, postSchema);

  if (body.action === "mark_read") {
    await db.notification.updateMany({
      where: { id: body.id, organizationId: ctx.organizationId },
      data: { status: "READ", readAt: new Date() },
    });
    return ok({ read: true });
  }

  if (body.action === "template") {
    const existing = await db.notificationTemplate.findFirst({
      where: { organizationId: ctx.organizationId, event: body.event, channel: body.channel },
    });
    const tpl = existing
      ? await db.notificationTemplate.update({
          where: { id: existing.id },
          data: { subject: body.subject, body: body.body },
        })
      : await db.notificationTemplate.create({
          data: {
            organizationId: ctx.organizationId,
            event: body.event,
            channel: body.channel,
            subject: body.subject,
            body: body.body,
          },
        });
    return ok(tpl, 201);
  }

  const sent = await dispatchNotification({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    event: body.event,
    channels: body.channels,
    variables: body.variables,
  });
  return ok(sent, 201);
});

