import { z } from "zod";
import { route, ok } from "@/lib/api";
import { processPayHereWebhook } from "@/modules/finance/service";

export const dynamic = "force-dynamic";

const webhookSchema = z.object({
  merchant_id: z.string().min(1),
  order_id: z.string().min(1),
  payment_id: z.string().min(1),
  payhere_amount: z.string().min(1),
  payhere_currency: z.string().min(1),
  status_code: z.string().min(1),
  md5sig: z.string().min(1),
});

/**
 * PayHere server-to-server notification webhook (`notify_url`).
 * Accepts `application/x-www-form-urlencoded` (PayHere standard) or `application/json`.
 */
export const POST = route(async (req: Request) => {
  const ct = req.headers.get("content-type") ?? "";
  let raw: Record<string, unknown>;
  if (ct.includes("application/json")) {
    raw = (await req.json()) as Record<string, unknown>;
  } else {
    const form = await req.formData();
    raw = Object.fromEntries(form.entries());
  }
  const payload = webhookSchema.parse(raw);
  const res = await processPayHereWebhook(payload);
  return ok(res);
});

