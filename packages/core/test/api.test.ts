import { describe, expect, test } from "vitest";
import type { ApiTokenId, CommandKey, Instant, WorkspaceId } from "../src/shared/types.ts";
import {
  API_ROUTES,
  WEBHOOK_EVENT_TYPES,
  afterAttempt,
  apiCommandKey,
  authenticateToken,
  bearerToken,
  buildCommand,
  decideIssueToken,
  decideRevokeToken,
  httpStatus,
  matchRoute,
  parseScopes,
  planDeliveries,
  requireScope,
  retryDelayMs,
  signWebhook,
  verifyWebhook,
  webhookEventId,
  webhookEventType,
  webhookPayload,
  type Crypto,
  type Delivery,
  type OutboxEvent,
  type WebhookEndpoint,
} from "../src/api/index.ts";
import { memberActor } from "./fixtures.ts";

const WS = "ws-1" as WorkspaceId;
const T0 = Date.UTC(2026, 10, 25, 15, 0, 0) as Instant;
const admin = memberActor("boss", "admin");

/** A transparent fake: the tests see exactly what was hashed or signed. */
const fakeCrypto: Crypto = {
  hmacSha256Hex: (secret, message) => `hmac(${secret}|${message})`,
  sha256Hex: (text) => `sha(${text})`,
  randomToken: () => "rnd",
};

const issue = (scopes: string[]) => {
  const r = decideIssueToken(admin, WS, { name: "ERP", scopes }, { id: "tok-1" as ApiTokenId, secret: "s3cret" }, fakeCrypto, T0);
  if (!r.ok) throw new Error("issue failed");
  return r.value;
};

describe("S97: resources", () => {
  test("S97: every resource is readable and writes are exactly bonuses, deductions, redemption transitions and rewards CRUD", () => {
    const reads = new Set(API_ROUTES.filter((r) => r.method === "GET").map((r) => r.resource));
    expect([...reads].sort()).toEqual(["balances", "gifts", "leaderboards", "ledger", "members", "quests", "redemptions", "rewards"]);
    expect(API_ROUTES.filter((r) => r.command !== null).map((r) => `${r.method} ${r.path} -> ${r.command}`)).toEqual([
      "POST /bonuses -> GrantBonus",
      "POST /deductions -> Deduct",
      "POST /redemptions/:id/approve -> TransitionRedemption",
      "POST /redemptions/:id/reject -> TransitionRedemption",
      "POST /redemptions/:id/fulfil -> TransitionRedemption",
      "POST /rewards -> CreateReward",
      "PATCH /rewards/:id -> UpdateReward",
      "DELETE /rewards/:id -> SetRewardStatus",
    ]);
    expect(API_ROUTES.every((r) => (r.method === "GET") === (r.command === null))).toBe(true);
  });

  test("S97: routes match with or without the base path and query string, and decode params", () => {
    expect(matchRoute("get", "/api/v1/members/U%201/balances?x=1")).toMatchObject({ route: { id: "balances.get" }, params: { id: "U 1" } });
    expect(matchRoute("POST", "/redemptions/r1/fulfil")).toMatchObject({ route: { id: "redemptions.fulfil" }, params: { id: "r1" } });
    expect(matchRoute("PUT", "/api/v1/rewards/r1")).toBeNull();
    expect(matchRoute("GET", "/api/v1/unknown")).toBeNull();
  });

  test("S97: a write becomes its command; only JSON shape is checked, rules stay in the deciders", () => {
    const ctx = { key: "api:tok-1:k" as CommandKey, workspaceId: WS, actor: admin };
    const bonus = buildCommand(matchRoute("POST", "/bonuses")!, { member_ids: ["a"], amount: -5, reason: "" }, ctx);
    expect(bonus).toEqual({ ok: true, value: { type: "GrantBonus", key: ctx.key, workspaceId: WS, actor: admin, at: 0, memberIds: ["a"], amount: -5, reason: "" } });
    expect(buildCommand(matchRoute("POST", "/deductions")!, { member_id: 7, amount: 1, reason: "x" }, ctx)).toEqual({ ok: false, error: { code: "invalid_request", field: "member_id" } });
    expect(buildCommand(matchRoute("POST", "/redemptions/r9/reject")!, { reason: "no" }, ctx)).toMatchObject({ ok: true, value: { type: "TransitionRedemption", redemptionId: "r9", transition: "reject", reason: "no" } });
    expect(buildCommand(matchRoute("POST", "/redemptions/r9/approve")!, undefined, ctx)).toMatchObject({ ok: true, value: { transition: "approve", reason: null } });
    expect(buildCommand(matchRoute("DELETE", "/rewards/rw")!, null, ctx)).toMatchObject({ ok: true, value: { type: "SetRewardStatus", rewardId: "rw", status: "archived" } });
    expect(buildCommand(matchRoute("POST", "/rewards")!, [1], ctx)).toEqual({ ok: false, error: { code: "invalid_request", field: "body" } });
  });

  test("S97: rewards CRUD builds the shop's own commands (CreateReward, UpdateReward, SetRewardStatus)", () => {
    const ctx = { key: "api:tok-1:k" as CommandKey, workspaceId: WS, actor: admin };
    const created = buildCommand(matchRoute("POST", "/rewards")!, { title: "Mug", cost: 12, internal_cost: { minor: 900, currency: "PEN" }, variants: [{ id: "red", name: "Red", stock: 3 }] }, ctx);
    expect(created).toMatchObject({
      ok: true,
      value: {
        type: "CreateReward",
        reward: { title: "Mug", cost: 12, description: "", image: null, stock: null, variants: [{ id: "red", name: "Red", stock: 3 }], categories: [], internalCost: { minor: 900, currency: "PEN" }, instructions: "", autoApprove: null, giftCard: false },
      },
    });
    expect(buildCommand(matchRoute("POST", "/rewards")!, { title: "Mug" }, ctx)).toEqual({ ok: false, error: { code: "invalid_request", field: "cost" } });
    expect(buildCommand(matchRoute("POST", "/rewards")!, { title: "Mug", cost: "12" }, ctx)).toEqual({ ok: false, error: { code: "invalid_request", field: "cost" } });
    expect(buildCommand(matchRoute("PATCH", "/rewards/rw")!, { cost: 15, auto_approve: true }, ctx)).toMatchObject({ ok: true, value: { type: "UpdateReward", rewardId: "rw", changes: { cost: 15, autoApprove: true } } });
    // Stock and status have their own commands (S45, S46); PATCH refuses them instead of ignoring them.
    expect(buildCommand(matchRoute("PATCH", "/rewards/rw")!, { stock: 4 }, ctx)).toEqual({ ok: false, error: { code: "invalid_request", field: "stock" } });
    expect(buildCommand(matchRoute("PATCH", "/rewards/rw")!, { colour: "red" }, ctx)).toEqual({ ok: false, error: { code: "invalid_request", field: "colour" } });
  });
});

describe("S98: tokens and scopes", () => {
  test("S98: issuing needs an admin, stores only the hash of the plaintext, and scopes are explicit", () => {
    const { token, record } = issue(["ledger:read", "adjustments:write", "ledger:read"]);
    expect(token).toBe("propi_tok-1.s3cret");
    expect(record).toEqual({ id: "tok-1", workspaceId: WS, name: "ERP", scopes: ["adjustments:write", "ledger:read"], secretHash: "sha(propi_tok-1.s3cret)", createdAt: T0, createdBy: admin, revokedAt: null });
    expect(decideIssueToken(memberActor("ana"), WS, { name: "x", scopes: ["ledger:read"] }, { id: "t" as ApiTokenId, secret: "s" }, fakeCrypto, T0)).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    const tokenActor = { kind: "apiToken", tokenId: "tok-1" as ApiTokenId, scopes: ["adjustments:write"] } as const;
    expect(decideIssueToken(tokenActor, WS, { name: "x", scopes: ["ledger:read"] }, { id: "t" as ApiTokenId, secret: "s" }, fakeCrypto, T0)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(parseScopes([])).toEqual({ ok: false, error: { code: "invalid_request", field: "scopes" } });
    expect(parseScopes(["ledger:write"])).toEqual({ ok: false, error: { code: "invalid_scope", scope: "ledger:write" } });
  });

  test("S98: authentication checks the hash and revocation; the actor is the token with its scopes", () => {
    const { token, record } = issue(["ledger:read"]);
    expect(authenticateToken(token, record, fakeCrypto)).toEqual({ ok: true, value: { record, actor: { kind: "apiToken", tokenId: "tok-1", scopes: ["ledger:read"] } } });
    expect(authenticateToken("propi_tok-1.wrong", record, fakeCrypto)).toEqual({ ok: false, error: { code: "unauthenticated" } });
    expect(authenticateToken(token, null, fakeCrypto)).toEqual({ ok: false, error: { code: "unauthenticated" } });
    expect(authenticateToken(null, record, fakeCrypto)).toEqual({ ok: false, error: { code: "unauthenticated" } });
    const revoked = decideRevokeToken(admin, WS, record, (T0 + 5) as Instant);
    expect(revoked).toEqual({ ok: true, value: { ...record, revokedAt: T0 + 5 } });
    if (!revoked.ok) throw new Error();
    expect(authenticateToken(token, revoked.value, fakeCrypto)).toEqual({ ok: false, error: { code: "token_revoked" } });
    expect(decideRevokeToken(admin, WS, revoked.value, (T0 + 99) as Instant)).toEqual({ ok: true, value: revoked.value });
    expect(decideRevokeToken(admin, "ws-2" as WorkspaceId, record, T0)).toEqual({ ok: false, error: { code: "token_not_found" } });
    expect(bearerToken("Bearer abc ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
  });

  test("S98: scope checks are pure and only token actors carry scopes", () => {
    const actor = { kind: "apiToken", tokenId: "t" as ApiTokenId, scopes: ["ledger:read"] } as const;
    expect(requireScope(actor, "ledger:read")).toEqual({ ok: true, value: actor });
    expect(requireScope(actor, "rewards:write")).toEqual({ ok: false, error: { code: "forbidden", need: "rewards:write" } });
    expect(requireScope(admin, "ledger:read")).toEqual({ ok: false, error: { code: "forbidden", need: "ledger:read" } });
  });
});

describe("S100: idempotency policy", () => {
  test("S100: Idempotency-Key becomes api:<tokenId>:<key>; reuse with another body maps to 422", () => {
    expect(apiCommandKey("tok-1" as ApiTokenId, "order-42")).toEqual({ ok: true, value: "api:tok-1:order-42" });
    expect(apiCommandKey("tok-1" as ApiTokenId, undefined)).toEqual({ ok: false, error: { code: "idempotency_key_required" } });
    expect(apiCommandKey("tok-1" as ApiTokenId, "has space")).toEqual({ ok: false, error: { code: "invalid_idempotency_key" } });
    expect(apiCommandKey("tok-1" as ApiTokenId, "x".repeat(256))).toEqual({ ok: false, error: { code: "invalid_idempotency_key" } });
    expect(httpStatus({ code: "idempotency_key_reused" })).toBe(422);
    expect(httpStatus({ code: "idempotency_key_required" })).toBe(400);
    expect(httpStatus({ code: "token_revoked" })).toBe(401);
    expect(httpStatus({ code: "forbidden" })).toBe(403);
  });
});

describe("S99: webhooks", () => {
  const event = (over: Partial<OutboxEvent> = {}): OutboxEvent => ({ id: "evt_1", workspaceId: WS, type: "gift.given", at: T0, data: { giftId: "g1" }, ...over });
  const endpoint = (over: Partial<WebhookEndpoint> = {}): WebhookEndpoint => ({ id: "ep1", workspaceId: WS, url: "https://x", secret: "s", events: "*", active: true, ...over });

  test("S99: the catalog covers gifts, redemptions, quest submissions, rule awards and member changes; internal events stay internal", () => {
    const families = new Set(WEBHOOK_EVENT_TYPES.map((t) => t.split(".")[0]));
    expect([...families].sort()).toEqual(["gift", "member", "quest", "redemption", "rule"]);
    for (const t of ["redemption.created", "redemption.approved", "redemption.rejected", "redemption.cancelled", "redemption.fulfilled"]) expect(webhookEventType(t)).toBe(t);
    expect(webhookEventType("gift.rejected")).toBeNull();
    expect(webhookEventType("adjustment.made")).toBeNull();
    expect(webhookEventType("toString")).toBeNull();
  });

  test("S99: the payload is {id, type, created_at, workspace_id, data} and the id is stable per outbox event", () => {
    expect(webhookPayload(event())).toEqual({ id: "evt_1", type: "gift.given", created_at: "2026-11-25T15:00:00.000Z", workspace_id: "ws-1", data: { giftId: "g1" } });
    expect(webhookPayload(event({ type: "gift.rejected" }))).toBeNull();
    const id = webhookEventId(WS, "slack:msg:T:C:1" as CommandKey, 0);
    expect(id).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(webhookEventId(WS, "slack:msg:T:C:1" as CommandKey, 0)).toBe(id);
    expect(webhookEventId(WS, "slack:msg:T:C:1" as CommandKey, 1)).not.toBe(id);
  });

  test("S99: the signature is t=<unix>,v1=<hmac of t + '.' + body> with the endpoint secret", () => {
    const header = signWebhook(fakeCrypto, "whsec", '{"a":1}', (T0 + 999) as Instant);
    const t = Math.floor(T0 / 1000);
    expect(header).toBe(`t=${t},v1=hmac(whsec|${t}.{"a":1})`);
    expect(verifyWebhook(fakeCrypto, "whsec", '{"a":1}', header, T0)).toEqual({ ok: true });
    expect(verifyWebhook(fakeCrypto, "whsec", '{"a":2}', header, T0)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyWebhook(fakeCrypto, "whsec", '{"a":1}', header, (T0 + 301_000) as Instant)).toEqual({ ok: false, reason: "expired" });
    expect(verifyWebhook(fakeCrypto, "whsec", '{"a":1}', "v1=abc", T0)).toEqual({ ok: false, reason: "malformed" });
  });

  test("S99: backoff doubles from 1 min and caps at 12 h; the 12th failure is dead; success and dead are final", () => {
    expect(Array.from({ length: 12 }, (_, i) => retryDelayMs(i + 1) / 60_000)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 720, 720]);
    let d: Delivery = { id: "evt_1|ep1", workspaceId: WS, eventId: "evt_1", endpointId: "ep1", status: "pending", attempts: 0, nextAttemptAt: T0, lastError: null };
    for (let i = 1; i <= 11; i++) {
      d = afterAttempt(d, { ok: false, error: "500" }, d.nextAttemptAt);
      expect(d).toMatchObject({ status: "pending", attempts: i });
    }
    d = afterAttempt(d, { ok: false, error: "500" }, d.nextAttemptAt);
    expect(d).toMatchObject({ status: "dead", attempts: 12, lastError: "500" });
    expect(afterAttempt(d, { ok: true }, T0)).toBe(d);
    const done = afterAttempt({ ...d, status: "pending", attempts: 3 }, { ok: true }, T0);
    expect(done).toMatchObject({ status: "done", attempts: 4, lastError: null });
    expect(afterAttempt(done, { ok: false, error: "x" }, T0)).toBe(done);
  });

  test("S99: deliveries dedupe by event id per endpoint, respect subscriptions, workspace and active flag", () => {
    const events = [event(), event(), event({ id: "evt_2", type: "redemption.created" }), event({ id: "evt_3", type: "adjustment.made" })];
    const eps = [endpoint(), endpoint({ id: "ep2", events: ["redemption.created"] }), endpoint({ id: "ep3", active: false }), endpoint({ id: "ep4", workspaceId: "ws-2" as WorkspaceId })];
    const planned = planDeliveries(events, eps, new Set(), T0);
    expect(planned.map((d) => d.id)).toEqual(["evt_1|ep1", "evt_2|ep1", "evt_2|ep2"]);
    expect(planned[0]).toEqual({ id: "evt_1|ep1", workspaceId: WS, eventId: "evt_1", endpointId: "ep1", status: "pending", attempts: 0, nextAttemptAt: T0, lastError: null });
    expect(planDeliveries(events, eps, new Set(planned.map((d) => d.id)), T0)).toEqual([]);
  });
});
