// S6: the Polar webhook endpoint logic: signature first, then one idempotent upsert per event id.
import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { WorkspaceId } from "@propi/core";
import { createMemoryBillingStore } from "@propi/app/testing";
import { handlePolarWebhook } from "../src/server/billing-webhook.ts";

const SECRET = "whsec_" + Buffer.from("a-test-signing-key-of-32-bytes!!").toString("base64");
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const ts = String(Math.floor(NOW / 1000));

function signed(id: string, body: string, at = ts) {
  const key = Buffer.from(SECRET.slice(6), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${at}.${body}`).digest("base64");
  return new Headers({ "webhook-id": id, "webhook-timestamp": at, "webhook-signature": `v1,${sig}` });
}

const event = (status = "active", modified = "2026-11-25T10:00:00Z") =>
  JSON.stringify({
    type: "subscription.updated",
    data: { id: "sub_1", status, current_period_end: "2026-12-25T00:00:00Z", cancel_at_period_end: false, created_at: "2026-11-25T00:00:00Z", modified_at: modified, metadata: { workspaceId: "ws-1" }, customer: { id: "cus_1", external_id: "ws-1" } },
  });

describe("S6 Polar webhook endpoint", () => {
  test("a bad signature is refused with 403 and stores nothing; an expired one with 401", async () => {
    const billing = createMemoryBillingStore();
    const body = event();
    const headers = signed("evt_1", body);
    headers.set("webhook-signature", "v1,AAAA");
    expect((await handlePolarWebhook({ secret: SECRET, billing, now: NOW }, headers, body)).status).toBe(403);
    const old = signed("evt_1", body, String(Math.floor(NOW / 1000) - 600));
    expect((await handlePolarWebhook({ secret: SECRET, billing, now: NOW }, old, body)).status).toBe(401);
    expect((await billing.account("ws-1" as WorkspaceId)).subscription).toBeNull();
  });

  test("a valid event upserts the subscription; a replay of the same event id is acknowledged and ignored", async () => {
    const billing = createMemoryBillingStore();
    const body = event();
    const first = await handlePolarWebhook({ secret: SECRET, billing, now: NOW }, signed("evt_1", body), body);
    expect(first).toEqual({ status: 200, result: "applied" });
    expect((await billing.account("ws-1" as WorkspaceId)).subscription?.status).toBe("active");
    const again = await handlePolarWebhook({ secret: SECRET, billing, now: NOW }, signed("evt_1", body), body);
    expect(again).toEqual({ status: 200, result: "duplicate" });
  });

  test("events without a subscription (e.g. order.paid) are acknowledged and ignored", async () => {
    const billing = createMemoryBillingStore();
    const body = JSON.stringify({ type: "order.paid", data: { id: "ord_1" } });
    expect(await handlePolarWebhook({ secret: SECRET, billing, now: NOW }, signed("evt_9", body), body)).toEqual({ status: 200, result: "ignored" });
  });

  test("a signed body that is not JSON is a 400", async () => {
    const billing = createMemoryBillingStore();
    expect((await handlePolarWebhook({ secret: SECRET, billing, now: NOW }, signed("evt_2", "nope"), "nope")).status).toBe(400);
  });
});
