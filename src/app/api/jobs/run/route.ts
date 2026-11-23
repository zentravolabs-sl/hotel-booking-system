import { route, ok } from "@/lib/api";
import { runScheduledMaintenanceJobs } from "@/modules/saas/jobs";

export const dynamic = "force-dynamic";

export const POST = route(async () => {
  return ok(await runScheduledMaintenanceJobs());
});
