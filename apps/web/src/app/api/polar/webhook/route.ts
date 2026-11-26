// S6: Polar webhooks (subscription.*). Signature-verified, idempotent by webhook-id.
import { billingStore } from "@/server/billing";
import { handlePolarWebhook } from "@/server/billing-webhook";
import { polarConfig } from "@/server/env";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const cfg = polarConfig();
  if (cfg === null) return Response.json({ error: "billing_not_configured" }, { status: 404 });
  const body = await req.text();
  const out = await handlePolarWebhook({ secret: cfg.webhookSecret, billing: billingStore(), now: Date.now() }, req.headers, body);
  // A second live subscription for a workspace is refused (S12a); surface it so someone can act.
  if (out.result === "foreign") console.warn(JSON.stringify({ msg: "polar webhook foreign subscription", at: new Date().toISOString() }));
  return Response.json({ result: out.result }, { status: out.status });
}
