import { createHash, createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { verifyWebhook, type MemberId, type WebhookPayload } from "@propi/core";
import { nodeCrypto } from "../src/api/index.ts";
import { apiSetup, at, pendingRedemption, T0, WS } from "./api.setup.ts";
import { giveCmd, m, mention, msg } from "./setup.ts";

const ALL = ["members:read", "ledger:read", "rewards:read", "rewards:write", "redemptions:read", "redemptions:write", "adjustments:write", "quests:read", "leaderboards:read"];

describe("S97: REST resources and the command each write maps to", () => {
  test("S97: POST /bonuses runs GrantBonus and writes bonus entries", async () => {
    const s = apiSetup();
    const { token } = await s.issue(["adjustments:write"]);
    const r = await s.call(token, "POST", "/api/v1/bonuses", { member_ids: ["ana", "bob"], amount: 5, reason: "launch" }, "k1");
    expect(r).toEqual({ status: 200, headers: { "content-type": "application/json", "idempotent-replayed": "false" }, body: { data: { memberIds: ["ana", "bob"], amount: 5 } } });
    expect(s.mem.entries(WS).map((e) => [e.kind, e.memberId, e.amount])).toEqual([["bonus", "ana", 5], ["bonus", "bob", 5]]);
    expect(s.mem.commandLog(WS).map((c) => c.commandType)).toEqual(["GrantBonus"]);
  });

  test("S97: POST /deductions runs Deduct; business rules stay in the decider (empty reason)", async () => {
    const s = apiSetup();
    const { token } = await s.issue(["adjustments:write"]);
    expect((await s.call(token, "POST", "/api/v1/deductions", { member_id: "ana", amount: 2, reason: "fix" }, "d1")).status).toBe(200);
    expect(await s.app.balances(WS, m("ana"))).toEqual({ received: 0, given: 0, redeemable: -2 });
    const empty = await s.call(token, "POST", "/api/v1/deductions", { member_id: "ana", amount: 2, reason: "" }, "d2");
    expect(empty).toMatchObject({ status: 422, body: { error: { code: "reason_required" } } });
    const negative = await s.call(token, "POST", "/api/v1/deductions", { member_id: "ana", amount: -3, reason: "x" }, "d3");
    expect(negative).toMatchObject({ status: 422, body: { error: { code: "invalid_amount" } } });
    const badShape = await s.call(token, "POST", "/api/v1/deductions", { member_id: "ana", amount: "2", reason: "x" }, "d4");
    expect(badShape).toMatchObject({ status: 400, body: { error: { code: "invalid_request", field: "amount" } } });
    expect(s.mem.entries(WS)).toHaveLength(1);
  });

  test("S97: redemption approve, reject and fulfil map to the shop's TransitionRedemption", async () => {
    const s = apiSetup();
    const { token, id } = await s.issue(["redemptions:write"]);
    const redemptionId = await pendingRedemption(s);
    const approve = await s.call(token, "POST", `/api/v1/redemptions/${redemptionId}/approve`, undefined, "t0");
    expect(approve).toMatchObject({ status: 200, body: { data: { redemptionId, state: "approved", changed: true } } });
    // S49: approved -> rejected is not an edge; the shop decider refuses it and the API reports it as 422.
    const reject = await s.call(token, "POST", `/api/v1/redemptions/${redemptionId}/reject`, { reason: "out of stock" }, "t1");
    expect(reject).toMatchObject({ status: 422, body: { error: { code: "illegal_transition", from: "approved", transition: "reject" } } });
    const fulfil = await s.call(token, "POST", `/api/v1/redemptions/${redemptionId}/fulfil`, undefined, "t2");
    expect(fulfil).toMatchObject({ status: 200, body: { data: { redemptionId, state: "fulfilled" } } });
    expect(s.mem.shop.state(WS).redemptions).toEqual([expect.objectContaining({ id: redemptionId, state: "fulfilled" })]);
    expect(s.captured.map((c) => ({ type: c.type, ...(c as unknown as { redemptionId: string; transition: string; reason: string | null }) }))).toEqual([
      expect.objectContaining({ type: "TransitionRedemption", redemptionId, transition: "approve", reason: null, key: `api:${id}:t0` }),
      expect.objectContaining({ type: "TransitionRedemption", redemptionId, transition: "reject", reason: "out of stock", key: `api:${id}:t1` }),
      expect.objectContaining({ type: "TransitionRedemption", redemptionId, transition: "fulfil", reason: null, key: `api:${id}:t2` }),
    ]);
  });

  test("S97: rewards CRUD maps to the shop's CreateReward, UpdateReward and SetRewardStatus", async () => {
    const s = apiSetup();
    const { token } = await s.issue(["rewards:write"]);
    const created = await s.call(token, "POST", "/api/v1/rewards", { title: "Mug", cost: 12 }, "r1");
    expect(created).toMatchObject({ status: 200, body: { data: { rewardId: expect.any(String) } } });
    const rewardId = (created.body as { data: { rewardId: string } }).data.rewardId;
    expect(await s.call(token, "PATCH", `/api/v1/rewards/${rewardId}`, { cost: 15 }, "r2")).toMatchObject({ status: 200 });
    expect(await s.call(token, "DELETE", `/api/v1/rewards/${rewardId}`, undefined, "r3")).toMatchObject({ status: 200, body: { data: { status: "archived" } } });
    expect(s.mem.shop.state(WS).rewards).toEqual([expect.objectContaining({ id: rewardId, title: "Mug", cost: 15, status: "archived" })]);
    // S45: an archived reward is final; editing it is a business refusal (422), not a shape error.
    expect(await s.call(token, "PATCH", `/api/v1/rewards/${rewardId}`, { cost: 20 }, "r4")).toMatchObject({ status: 422, body: { error: { code: "reward_not_active" } } });
    expect(s.captured.map((c) => c.type)).toEqual(["CreateReward", "UpdateReward", "SetRewardStatus", "UpdateReward"]);
    expect(s.captured[0]).toMatchObject({ reward: { title: "Mug", cost: 12 } });
    expect(s.captured[1]).toMatchObject({ rewardId, changes: { cost: 15 } });
    expect(s.captured[2]).toMatchObject({ rewardId, status: "archived" });
  });

  test("S97: reads expose members, balances and ledger entries; reads owned elsewhere answer 501 until wired", async () => {
    const s = apiSetup({ readers: { "quests.list": async () => [{ id: "q1" }] } });
    const { token } = await s.issue(ALL);
    await s.app.execute(giveCmd("giver", msg("@Ana :taco::taco:", [mention("ana")], 2)));
    const members = await s.call(token, "GET", "/api/v1/members");
    expect(members.status).toBe(200);
    expect((members.body as { data: { id: string }[] }).data.map((x) => x.id)).toContain("ana");
    expect(await s.call(token, "GET", "/api/v1/members/ana/balances")).toMatchObject({ status: 200, body: { data: { received: 2, given: 0, redeemable: 2 } } });
    expect(await s.call(token, "GET", "/api/v1/members/nobody")).toMatchObject({ status: 404, body: { error: { code: "unknown_member" } } });
    const ledger = await s.call(token, "GET", "/api/v1/ledger-entries");
    expect((ledger.body as { data: { kind: string; amount: number }[] }).data).toEqual([expect.objectContaining({ kind: "gift", amount: 2, member_id: "ana", counterpart_id: "giver" })]);
    expect(await s.call(token, "GET", "/api/v1/quests")).toMatchObject({ status: 200, body: { data: [{ id: "q1" }] } });
    expect(await s.call(token, "GET", "/api/v1/leaderboards/received")).toMatchObject({ status: 501, body: { error: { code: "not_implemented", route: "leaderboards.get" } } });
    expect(await s.call(token, "GET", "/api/v1/nope")).toMatchObject({ status: 404, body: { error: { code: "route_not_found" } } });
  });
});

describe("S98: API tokens", () => {
  test("S98: a token is stored only as a hash and the plaintext is returned once", async () => {
    const s = apiSetup();
    const { token, id } = await s.issue(["members:read"]);
    const [stored] = s.stores.tokens.all();
    expect(stored).toMatchObject({ id, workspaceId: WS, scopes: ["members:read"], revokedAt: null });
    expect(JSON.stringify(stored)).not.toContain(token.split(".")[1]);
    expect(stored?.secretHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect((await s.tokens.list(WS))[0]).not.toHaveProperty("secretHash");
  });

  test("S98: scopes are explicit; a missing scope is 403 and writes nothing", async () => {
    const s = apiSetup();
    const { token } = await s.issue(["members:read"]);
    const r = await s.call(token, "POST", "/api/v1/bonuses", { member_ids: ["ana"], amount: 5, reason: "x" }, "k1");
    expect(r).toMatchObject({ status: 403, body: { error: { code: "forbidden", need: "adjustments:write" } } });
    expect(s.mem.entries(WS)).toHaveLength(0);
    expect(s.mem.commandLog(WS)).toHaveLength(0);
    expect(await s.tokens.issue({ kind: "member", memberId: m("ana"), role: "member" }, WS, { name: "x", scopes: ["members:read"] })).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    expect(await s.tokens.issue({ kind: "apiToken", tokenId: "t" as never, scopes: ["adjustments:write"] }, WS, { name: "x", scopes: ["members:read"] })).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    expect(await s.tokens.issue({ kind: "member", memberId: m("boss"), role: "admin" }, WS, { name: "x", scopes: ["root"] })).toEqual({ ok: false, error: { code: "invalid_scope", scope: "root" } });
  });

  test("S98: every write records the token as its actor", async () => {
    const s = apiSetup();
    const { token, id } = await s.issue(["adjustments:write"]);
    await s.call(token, "POST", "/api/v1/bonuses", { member_ids: ["ana"], amount: 3, reason: "q4" }, "k1");
    expect(s.mem.commandLog(WS)[0]?.actor).toEqual({ kind: "apiToken", tokenId: id, scopes: ["adjustments:write"] });
    expect(await s.app.auditLog(WS)).toEqual([expect.objectContaining({ action: "bonus", reason: "q4", actor: { kind: "apiToken", tokenId: id, scopes: ["adjustments:write"] } })]);
  });

  test("S98: a revoked, unknown or tampered token is 401", async () => {
    const s = apiSetup();
    const { token, id } = await s.issue(["members:read"]);
    expect((await s.call(token, "GET", "/api/v1/members")).status).toBe(200);
    expect(await s.call(null, "GET", "/api/v1/members")).toMatchObject({ status: 401, body: { error: { code: "unauthenticated" } } });
    expect(await s.call(`${token}x`, "GET", "/api/v1/members")).toMatchObject({ status: 401, body: { error: { code: "unauthenticated" } } });
    s.clock.set(T0 + 1000);
    const revoked = await s.tokens.revoke({ kind: "member", memberId: m("boss"), role: "admin" }, WS, id);
    expect(revoked).toMatchObject({ ok: true, value: { id, revokedAt: T0 + 1000 } });
    expect(await s.call(token, "GET", "/api/v1/members")).toMatchObject({ status: 401, body: { error: { code: "token_revoked" } } });
  });

  test("S98: a token is workspace-scoped: it acts only on the workspace it was issued for", async () => {
    const s = apiSetup();
    const { token } = await s.issue(["adjustments:write"]);
    await s.call(token, "POST", "/api/v1/bonuses", { member_ids: ["ana"], amount: 1, reason: "x" }, "k1");
    expect(s.mem.commandLog(WS)[0]?.workspaceId).toBe(WS);
    const otherWs = "ws-2" as typeof WS;
    expect(await s.tokens.revoke({ kind: "member", memberId: m("boss"), role: "admin" }, otherWs, s.stores.tokens.all()[0]!.id)).toEqual({ ok: false, error: { code: "token_not_found" } });
  });
});

describe("S100: idempotency keys", () => {
  test("S100: retrying the same key returns the original result and writes once", async () => {
    const s = apiSetup();
    const { token } = await s.issue(["adjustments:write"]);
    const body = { member_ids: ["ana"], amount: 4, reason: "launch" };
    const first = await s.call(token, "POST", "/api/v1/bonuses", body, "same");
    s.clock.advance(60_000);
    const retry = await s.call(token, "POST", "/api/v1/bonuses", body, "same");
    expect(retry.body).toEqual(first.body);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(s.mem.entries(WS)).toHaveLength(1);
    expect(s.mem.commandLog(WS).map((c) => c.key)).toEqual([expect.stringMatching(/^api:apiToken-\d+:same$/)]);
  });

  test("S100: the same key with a different body is 422 idempotency_key_reused", async () => {
    const s = apiSetup();
    const { token } = await s.issue(["adjustments:write"]);
    await s.call(token, "POST", "/api/v1/bonuses", { member_ids: ["ana"], amount: 4, reason: "launch" }, "same");
    const r = await s.call(token, "POST", "/api/v1/bonuses", { member_ids: ["ana"], amount: 9, reason: "launch" }, "same");
    expect(r).toMatchObject({ status: 422, body: { error: { code: "idempotency_key_reused" } } });
    expect(s.mem.entries(WS)).toHaveLength(1);
  });

  test("S100: writes need a key; keys are per token", async () => {
    const s = apiSetup();
    const a = await s.issue(["adjustments:write"], "a");
    const b = await s.issue(["adjustments:write"], "b");
    const body = { member_ids: ["ana"], amount: 1, reason: "x" };
    expect(await s.call(a.token, "POST", "/api/v1/bonuses", body)).toMatchObject({ status: 400, body: { error: { code: "idempotency_key_required" } } });
    expect(await s.call(a.token, "POST", "/api/v1/bonuses", body, "bad key")).toMatchObject({ status: 400, body: { error: { code: "invalid_idempotency_key" } } });
    await s.call(a.token, "POST", "/api/v1/bonuses", body, "k");
    await s.call(b.token, "POST", "/api/v1/bonuses", body, "k");
    expect(s.mem.entries(WS)).toHaveLength(2);
  });
});

describe("S99: webhooks", () => {
  test("S99: node:crypto implements the Crypto port (RFC 4231 HMAC-SHA256 vector)", () => {
    expect(nodeCrypto.hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    expect(nodeCrypto.sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(nodeCrypto.randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("S99: a gift becomes one signed delivery with the documented payload; internal events are not sent", async () => {
    const s = apiSetup();
    s.stores.endpoints.add({ id: "ep1", workspaceId: WS, url: "https://hooks.example/propi", secret: "whsec_1", events: "*", active: true });
    await s.app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1)));
    const { token } = await s.issue(["adjustments:write"]);
    await s.call(token, "POST", "/api/v1/bonuses", { member_ids: ["ana"], amount: 1, reason: "x" }, "k"); // adjustment.made: internal
    const summary = await s.relay.tick(WS);
    expect(summary).toEqual({ planned: 1, attempted: 1, delivered: 1, failed: 0, dead: 0 });
    const [req] = s.stores.transport.requests;
    const payload = JSON.parse(req!.body) as WebhookPayload;
    expect(Object.keys(payload)).toEqual(["id", "type", "created_at", "workspace_id", "data"]);
    expect(payload).toMatchObject({ type: "gift.given", created_at: new Date(T0).toISOString(), workspace_id: WS, data: { giver: "giver", receivers: ["ana"], perReceiver: 1 } });
    expect(req!.headers["X-Propi-Event-Id"]).toBe(payload.id);
    // A receiver verifies with plain node:crypto, exactly as docs/api.md shows.
    const sig = req!.headers["X-Propi-Signature"]!;
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig)!;
    expect(v1).toBe(createHmac("sha256", "whsec_1").update(`${t}.${req!.body}`).digest("hex"));
    expect(Number(t)).toBe(Math.floor(T0 / 1000));
    expect(verifyWebhook(nodeCrypto, "whsec_1", req!.body, sig, at(T0))).toEqual({ ok: true });
    expect(verifyWebhook(nodeCrypto, "other", req!.body, sig, at(T0))).toEqual({ ok: false, reason: "mismatch" });
  });

  test("S99: failures retry with exponential backoff from 1 min to 12 h, and 12 attempts end dead", async () => {
    const s = apiSetup();
    s.stores.endpoints.add({ id: "ep1", workspaceId: WS, url: "https://down.example", secret: "s", events: ["gift.given"], active: true });
    s.stores.transport.respond = () => ({ status: 503 });
    await s.app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1)));
    const gaps: number[] = [];
    let last = s.mem.ports.clock.now();
    for (let i = 0; i < 12; i++) {
      const d = s.stores.deliveries.all()[0];
      if (d !== undefined) {
        gaps.push((d.nextAttemptAt - last) / 60_000);
        last = d.nextAttemptAt;
        s.clock.set(d.nextAttemptAt);
      }
      await s.relay.tick(WS);
      if (i === 0) expect(await s.relay.tick(WS)).toEqual({ planned: 0, attempted: 0, delivered: 0, failed: 0, dead: 0 }); // not due yet
    }
    expect(gaps).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 720]);
    expect(s.stores.deliveries.all()).toEqual([expect.objectContaining({ status: "dead", attempts: 12, lastError: "http 503" })]);
    expect(s.stores.transport.requests).toHaveLength(12);
    s.clock.advance(24 * 3600_000);
    expect(await s.relay.tick(WS)).toEqual({ planned: 0, attempted: 0, delivered: 0, failed: 0, dead: 0 });
  });

  test("S99: an event is delivered once per endpoint (dedupe by event id), and a replayed command emits nothing new", async () => {
    const s = apiSetup();
    s.stores.endpoints.add({ id: "ep1", workspaceId: WS, url: "https://a.example", secret: "s", events: "*", active: true });
    const cmd = giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1));
    await s.app.execute(cmd);
    await s.relay.tick(WS);
    await s.app.execute(cmd); // Slack retry: replayed, no new outbox event
    expect(await s.relay.tick(WS)).toEqual({ planned: 0, attempted: 0, delivered: 0, failed: 0, dead: 0 });
    expect(s.stores.transport.requests).toHaveLength(1);
    const ids = s.stores.transport.requests.map((r) => r.headers["X-Propi-Event-Id"]);
    expect(new Set(ids).size).toBe(1);
  });

  test("S99: a network error counts as a failed attempt and is retried", async () => {
    const s = apiSetup();
    s.stores.endpoints.add({ id: "ep1", workspaceId: WS, url: "https://flaky.example", secret: "s", events: "*", active: true });
    let calls = 0;
    s.stores.transport.respond = () => {
      if (++calls === 1) throw new Error("ECONNRESET");
      return { status: 204 };
    };
    await s.app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1)));
    expect(await s.relay.tick(WS)).toMatchObject({ attempted: 1, failed: 1 });
    expect(s.stores.deliveries.all()[0]).toMatchObject({ status: "pending", attempts: 1, lastError: "ECONNRESET", nextAttemptAt: T0 + 60_000 });
    s.clock.advance(60_000);
    expect(await s.relay.tick(WS)).toMatchObject({ attempted: 1, delivered: 1 });
    expect(s.stores.deliveries.all()[0]).toMatchObject({ status: "done", attempts: 2 });
  });
});

describe("S107: identities across platforms share one balance", () => {
  test("S107: Slack and Teams identities of one member resolve to the same balance and allowance", async () => {
    const s = apiSetup();
    const ids = s.identities;
    const linkAs = { kind: "system", job: "oauth" } as const;
    expect(await ids.link({ actor: linkAs, workspaceId: WS, identity: { platform: "slack", tenantId: "T1", userId: "U_ANA" }, memberId: m("ana") })).toMatchObject({ ok: true, value: { changed: true } });
    expect(await ids.link({ actor: linkAs, workspaceId: WS, identity: { platform: "teams", tenantId: "tn-1", userId: "29:ana" }, memberId: m("ana") })).toMatchObject({ ok: true, value: { changed: true } });
    expect(await ids.link({ actor: linkAs, workspaceId: WS, identity: { platform: "slack", tenantId: "T1", userId: "U_ANA" }, memberId: m("bob") })).toEqual({ ok: false, error: { code: "identity_taken", memberId: "ana" } });

    const viaSlack = await ids.actorFor(WS, { platform: "slack", tenantId: "T1", userId: "U_ANA" });
    const viaTeams = await ids.actorFor(WS, { platform: "teams", tenantId: "tn-1", userId: "29:ana" });
    expect(viaSlack).toEqual({ kind: "member", memberId: "ana", role: "member" });
    expect(viaTeams).toEqual(viaSlack);

    // Ana gives 3 from Slack, then 2 from Teams: one allowance, one ledger identity.
    await s.app.execute({ ...giveCmd("ana", msg("@Bob :taco::taco::taco:", [mention("bob")], 3)), actor: viaSlack! });
    await s.app.execute({ ...giveCmd("ana", msg("@Bob :taco::taco:", [mention("bob")], 2)), actor: viaTeams! });
    expect(await s.app.allowance(WS, "ana" as MemberId)).toMatchObject({ used: 5, remaining: 0 });
    const over = await s.app.execute({ ...giveCmd("ana", msg("@Bob :taco:", [mention("bob")], 1)), actor: viaTeams! });
    expect(over).toMatchObject({ ok: false, error: { code: "over_allowance" } });
    const ana = await ids.resolve(WS, { platform: "teams", tenantId: "tn-1", userId: "29:ana" });
    expect(await s.app.balances(WS, ana!)).toEqual({ received: 0, given: 5, redeemable: 0 });
    expect(await ids.actorFor(WS, { platform: "teams", tenantId: "tn-1", userId: "29:unknown" })).toBeNull();
  });
});
