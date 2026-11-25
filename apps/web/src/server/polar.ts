// S6: the Polar adapter. Webhook signature checks (Standard Webhooks, plus Polar's legacy key), the
// mapping from Polar subscription events to the workspace subscription record, and the two API calls
// the billing page needs (checkout, customer portal). No SDK: fetch and node:crypto only.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Instant, SubscriptionRecord, WorkspaceId } from "@propi/core";
import type { polarConfig } from "./env";

export type PolarConfig = NonNullable<ReturnType<typeof polarConfig>>;

/** Standard Webhooks tolerance: a delivery more than 5 minutes off the server clock is refused. */
const TOLERANCE_SECONDS = 300;

export type WebhookCheck = { readonly ok: true } | { readonly ok: false; readonly reason: "missing_headers" | "expired" | "bad_signature" };

/**
 * Two keys are tried: Standard Webhooks (the base64 part after `whsec_`, secrets Polar made on or
 * after 2026-09-08) and Polar's legacy scheme (the UTF-8 bytes of the whole secret string).
 */
function signingKeys(secret: string): Buffer[] {
  const keys = [Buffer.from(secret, "utf8")];
  if (secret.startsWith("whsec_")) keys.unshift(Buffer.from(secret.slice("whsec_".length), "base64"));
  return keys;
}

export function verifyWebhook(
  secret: string,
  headers: { readonly id: string | null; readonly timestamp: string | null; readonly signature: string | null },
  body: string,
  nowSeconds: number,
): WebhookCheck {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return { ok: false, reason: "expired" };
  const given = signature
    .split(" ")
    .map((s) => s.split(","))
    .filter(([v, sig]) => v === "v1" && sig !== undefined)
    .map(([, sig]) => Buffer.from(sig!, "base64"));
  for (const key of signingKeys(secret)) {
    const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
    if (given.some((g) => g.length === expected.length && timingSafeEqual(g, expected))) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}

const SUBSCRIPTION_EVENTS = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.revoked",
  "subscription.past_due",
]);

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const time = (v: unknown): Instant | null => {
  const s = str(v);
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : (t as Instant);
};

/**
 * A Polar subscription event as the workspace's subscription record, or null for events that carry
 * no subscription or no workspace. The workspace is `metadata.workspaceId` (set on the checkout and
 * copied to the subscription), else the customer's external id (also the workspace id).
 */
export function subscriptionFromEvent(event: { readonly type: string; readonly data: unknown }): SubscriptionRecord | null {
  if (!SUBSCRIPTION_EVENTS.has(event.type) || typeof event.data !== "object" || event.data === null) return null;
  const d = event.data as Json;
  const metadata = (d.metadata ?? {}) as Json;
  const customer = (d.customer ?? {}) as Json;
  const workspaceId = str(metadata.workspaceId) ?? str(customer.external_id);
  const id = str(d.id);
  const status = str(d.status);
  const updated = time(d.modified_at) ?? time(d.created_at);
  if (workspaceId === null || id === null || status === null || updated === null) return null;
  return {
    workspaceId: workspaceId as WorkspaceId,
    provider: "polar",
    subscriptionId: id,
    customerId: str(d.customer_id) ?? str(customer.id),
    status,
    currentPeriodEnd: time(d.current_period_end),
    cancelAtPeriodEnd: d.cancel_at_period_end === true,
    seats: typeof d.seats === "number" ? d.seats : null,
    sourceUpdatedAt: updated,
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

async function post(cfg: PolarConfig, path: string, body: Json, fetcher: Fetch): Promise<Json> {
  const res = await fetcher(`${cfg.apiBase}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Polar API ${res.status} on ${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as Json;
}

/**
 * S6: a checkout for Pro, tied to the workspace (metadata.workspaceId and external customer id).
 * Pro is a seat-based price: `seats` is the workspace's active member count (at least 1).
 */
export async function createCheckoutUrl(
  cfg: PolarConfig,
  req: { readonly workspaceId: string; readonly seats: number; readonly successUrl: string },
  fetcher: Fetch = fetch,
): Promise<string> {
  const r = await post(
    cfg,
    "/v1/checkouts",
    {
      products: [cfg.productId],
      seats: Math.max(1, req.seats),
      metadata: { workspaceId: req.workspaceId },
      external_customer_id: req.workspaceId,
      success_url: req.successUrl,
    },
    fetcher,
  );
  const url = str(r.url);
  if (url === null) throw new Error("Polar checkout returned no url");
  return url;
}

/** S6: a short-lived customer portal link (manage seats, payment method, cancel). Never stored. */
export async function createPortalUrl(
  cfg: PolarConfig,
  req: { readonly workspaceId: string; readonly customerId: string | null; readonly returnUrl: string },
  fetcher: Fetch = fetch,
): Promise<string> {
  const who = req.customerId !== null ? { customer_id: req.customerId } : { external_customer_id: req.workspaceId };
  const r = await post(cfg, "/v1/customer-sessions", { ...who, return_url: req.returnUrl }, fetcher);
  const url = str(r.customer_portal_url);
  if (url === null) throw new Error("Polar customer session returned no portal url");
  return url;
}
