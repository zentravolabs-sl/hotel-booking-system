import { z } from "zod";
import { db } from "@/lib/db";
import { route, ok, conflict } from "@/lib/api";
import { requirePermission } from "@/lib/auth/context";
import { assertSameOrigin } from "@/lib/auth/session";
import { parseBody, audit } from "@/lib/http";
import { loadCabana } from "@/modules/cabanas/access";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

// Operational status only. RESERVED/OCCUPIED are driven by the booking flow, never set manually.
const schema = z.object({
  status: z.enum(["AVAILABLE", "CLEANING", "MAINTENANCE", "INACTIVE"]),
  reason: z.string().trim().max(300).optional(),
});

export const POST = route(async (req: Request, { params }: P) => {
  assertSameOrigin(req);
  const ctx = await requirePermission("cabana:manage");
  const { id } = await params;
  const c = await loadCabana(ctx, id);
  const { status, reason } = await parseBody(req, schema);
  if (c.archivedAt) throw conflict("Restore the cabana before changing its status");
  if (c.status === "OCCUPIED") throw conflict("Cabana is occupied. Check the guest out first.", "OCCUPIED");
  if (status === "AVAILABLE" && c.cleaningStatus === "DIRTY" )
    throw conflict("Cabana is dirty. Complete cleaning (and inspection) before marking it available.", "NEEDS_CLEANING");
  if (status === c.status) return ok(c);

  const upcoming = ["MAINTENANCE", "INACTIVE"].includes(status)
    ? await db.bookingItem.count({ where: { cabanaId: id, blocking: true, endAt: { gt: new Date() }, booking: { status: { in: ["PENDING", "CONFIRMED"] } } } })
    : 0;
  const [updated] = await db.$transaction([
    db.cabana.update({ where: { id }, data: { status } }),
    db.cabanaStatusHistory.create({ data: { cabanaId: id, fromStatus: c.status, toStatus: status, reason, changedById: ctx.userId } }),
  ]);
  await audit(ctx, "cabana.status", "Cabana", id, { from: c.status, to: status });
  return ok(updated, 200, upcoming ? { warning: `${upcoming} upcoming booking(s) exist for this cabana and need attention.` } : undefined);
});
