// S6: the Polar webhook endpoint logic, independent of Next. Signature first (403 bad, 401 expired),
// then one idempotent upsert per webhook-id; every verified delivery is acknowledged with 200 so Polar
// stops retrying, including replays and events that carry no subscription.
import type { ApplyBillingResult, BillingStore, Instant } from "@propi/core";
import { subscriptionFromEvent, verifyWebhook } from "./polar";

export interface WebhookOutcome {
  readonly status: number;
  readonly result: ApplyBillingResult | "ignored" | "invalid_signature" | "expired" | "invalid_json";
}

export async function handlePolarWebhook(d: { readonly secret: string; readonly billing: BillingStore; readonly now: number }, headers: Headers, body: string): Promise<WebhookOutcome> {
  const id = headers.get("webhook-id");
  const check = verifyWebhook(d.secret, { id, timestamp: headers.get("webhook-timestamp"), signature: headers.get("webhook-signature") }, body, Math.floor(d.now / 1000));
  if (!check.ok) return check.reason === "expired" ? { status: 401, result: "expired" } : { status: 403, result: "invalid_signature" };
  let event: { type: string; data: unknown };
  try {
    event = JSON.parse(body) as { type: string; data: unknown };
  } catch {
    return { status: 400, result: "invalid_json" };
  }
  const subscription = subscriptionFromEvent(event);
  if (subscription === null) return { status: 200, result: "ignored" };
  const result = await d.billing.applySubscriptionEvent({ eventId: id!, type: event.type, receivedAt: d.now as Instant, subscription });
  return { status: 200, result };
}
