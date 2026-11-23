import { z } from "zod";
import { route, ok } from "@/lib/api";
import { requirePermission, assertPropertyAccess } from "@/lib/auth/context";
import { searchParams } from "@/lib/http";
import { generateAnalyticsAndReports } from "@/modules/reports/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const ctx = await requirePermission("report:read");
  const q = z
    .object({
      propertyId: z.string().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    })
    .parse(searchParams(req));

  if (q.propertyId) await assertPropertyAccess(ctx, q.propertyId);

  const now = new Date();
  const from = q.from ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const to = q.to ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  return ok(
    await generateAnalyticsAndReports({
      organizationId: ctx.organizationId,
      propertyId: q.propertyId,
      from,
      to,
    }),
  );
});

