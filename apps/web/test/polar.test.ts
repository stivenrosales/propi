// S6: Polar webhooks (Standard Webhooks signatures), subscription mapping and the Polar API calls.
import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createCheckoutUrl, createPortalUrl, subscriptionFromEvent, verifyWebhook, type PolarConfig } from "../src/server/polar.ts";
import { polarConfig } from "../src/server/env.ts";

// The test vector from the Standard Webhooks specification.
const SPEC = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: "1614265330",
  body: '{"test": 2432232314}',
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};
const AT = 1614265330;

describe("S6 webhook signatures", () => {
  test("a valid Standard Webhooks signature verifies (spec vector), also among several signatures", () => {
    const h = { id: SPEC.id, timestamp: SPEC.timestamp, signature: SPEC.signature };
    expect(verifyWebhook(SPEC.secret, h, SPEC.body, AT)).toEqual({ ok: true });
    expect(verifyWebhook(SPEC.secret, { ...h, signature: `v1,bm90LWl0 ${SPEC.signature}` }, SPEC.body, AT + 60)).toEqual({ ok: true });
  });

  test("a Polar legacy signature (key = the whole secret's UTF-8 bytes) verifies too", () => {
    const sig = createHmac("sha256", Buffer.from(SPEC.secret, "utf8")).update(`${SPEC.id}.${SPEC.timestamp}.${SPEC.body}`).digest("base64");
    expect(verifyWebhook(SPEC.secret, { id: SPEC.id, timestamp: SPEC.timestamp, signature: `v1,${sig}` }, SPEC.body, AT)).toEqual({ ok: true });
  });

  test("a tampered body, id or signature is rejected", () => {
    const h = { id: SPEC.id, timestamp: SPEC.timestamp, signature: SPEC.signature };
    expect(verifyWebhook(SPEC.secret, h, '{"test": 2432232315}', AT)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyWebhook(SPEC.secret, { ...h, id: "msg_other" }, SPEC.body, AT)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyWebhook("whsec_" + Buffer.from("another key").toString("base64"), h, SPEC.body, AT)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyWebhook(SPEC.secret, { ...h, signature: null }, SPEC.body, AT)).toEqual({ ok: false, reason: "missing_headers" });
  });

  test("a timestamp more than 5 minutes away is rejected as expired", () => {
    const h = { id: SPEC.id, timestamp: SPEC.timestamp, signature: SPEC.signature };
    expect(verifyWebhook(SPEC.secret, h, SPEC.body, AT + 301)).toEqual({ ok: false, reason: "expired" });
    expect(verifyWebhook(SPEC.secret, h, SPEC.body, AT - 301)).toEqual({ ok: false, reason: "expired" });
  });
});

const polarSub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  current_period_end: "2026-12-25T00:00:00Z",
  cancel_at_period_end: false,
  created_at: "2026-11-25T00:00:00Z",
  modified_at: "2026-11-25T10:00:00Z",
  seats: 14,
  metadata: { workspaceId: "ws-1" },
  customer_id: "cus_1",
  customer: { id: "cus_1", external_id: "ws-1" },
  ...over,
});

describe("S6 subscription mapping", () => {
  test("a subscription event maps to the workspace's subscription record", () => {
    expect(subscriptionFromEvent({ type: "subscription.active", data: polarSub() })).toEqual({
      workspaceId: "ws-1",
      provider: "polar",
      subscriptionId: "sub_1",
      customerId: "cus_1",
      status: "active",
      currentPeriodEnd: Date.parse("2026-12-25T00:00:00Z"),
      cancelAtPeriodEnd: false,
      seats: 14,
      sourceUpdatedAt: Date.parse("2026-11-25T10:00:00Z"),
    });
  });

  test("the workspace falls back to the customer's external id; created_at stands in for a missing modified_at", () => {
    const r = subscriptionFromEvent({ type: "subscription.created", data: polarSub({ metadata: {}, modified_at: null, seats: undefined }) });
    expect(r).toMatchObject({ workspaceId: "ws-1", sourceUpdatedAt: Date.parse("2026-11-25T00:00:00Z"), seats: null });
  });

  test("cancel at period end and revocation keep their status and flags", () => {
    expect(subscriptionFromEvent({ type: "subscription.canceled", data: polarSub({ cancel_at_period_end: true }) })).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    expect(subscriptionFromEvent({ type: "subscription.revoked", data: polarSub({ status: "canceled" }) })).toMatchObject({ status: "canceled" });
  });

  test("other events, or a subscription with no workspace, are ignored", () => {
    expect(subscriptionFromEvent({ type: "order.paid", data: { id: "ord_1" } })).toBeNull();
    expect(subscriptionFromEvent({ type: "subscription.active", data: polarSub({ metadata: {}, customer: { id: "c", external_id: null } }) })).toBeNull();
  });
});

const cfg: PolarConfig = { accessToken: "polar_oat_x", webhookSecret: "whsec_x", productId: "prod_pro", apiBase: "https://sandbox-api.polar.sh" };

describe("S6 Polar API", () => {
  test("billing is not configured without the token or product id; sandbox is the default server", () => {
    expect(polarConfig({})).toBeNull();
    expect(polarConfig({ POLAR_ACCESS_TOKEN: "t", POLAR_WEBHOOK_SECRET: "s" })).toBeNull();
    expect(polarConfig({ POLAR_ACCESS_TOKEN: "t", POLAR_WEBHOOK_SECRET: "s", POLAR_PRO_PRODUCT_ID: "p" })).toEqual({ accessToken: "t", webhookSecret: "s", productId: "p", apiBase: "https://sandbox-api.polar.sh" });
    expect(polarConfig({ POLAR_ACCESS_TOKEN: "t", POLAR_WEBHOOK_SECRET: "s", POLAR_PRO_PRODUCT_ID: "p", POLAR_SERVER: "production" })?.apiBase).toBe("https://api.polar.sh");
  });

  test("checkout is tied to the workspace (metadata and external customer id) with seats = active members", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ url: "https://polar.sh/checkout/abc" }), { status: 201 });
    };
    const url = await createCheckoutUrl(cfg, { workspaceId: "ws-1", seats: 14, successUrl: "https://propi.test/admin/billing?ok=1" }, fetcher);
    expect(url).toBe("https://polar.sh/checkout/abc");
    expect(calls[0]!.url).toBe("https://sandbox-api.polar.sh/v1/checkouts");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer polar_oat_x");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      products: ["prod_pro"],
      seats: 14,
      metadata: { workspaceId: "ws-1" },
      external_customer_id: "ws-1",
      success_url: "https://propi.test/admin/billing?ok=1",
    });
  });

  test("the customer portal session uses the stored customer id, else the workspace as external id", async () => {
    const bodies: unknown[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return new Response(JSON.stringify({ customer_portal_url: "https://polar.sh/portal/x" }), { status: 201 });
    };
    expect(await createPortalUrl(cfg, { workspaceId: "ws-1", customerId: "cus_1", returnUrl: "https://propi.test/admin/billing" }, fetcher)).toBe("https://polar.sh/portal/x");
    await createPortalUrl(cfg, { workspaceId: "ws-1", customerId: null, returnUrl: "https://propi.test/admin/billing" }, fetcher);
    expect(bodies).toEqual([
      { customer_id: "cus_1", return_url: "https://propi.test/admin/billing" },
      { external_customer_id: "ws-1", return_url: "https://propi.test/admin/billing" },
    ]);
  });

  test("a Polar API error is surfaced, not swallowed", async () => {
    const fetcher = async () => new Response('{"detail":"nope"}', { status: 422 });
    await expect(createCheckoutUrl(cfg, { workspaceId: "ws-1", seats: 1, successUrl: "https://x.test" }, fetcher)).rejects.toThrow("Polar API 422");
  });
});
