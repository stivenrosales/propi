// S97-S100: the /api/v1 route handler, end to end over the in-memory ports: Request in, Response out.
import { beforeEach, describe, expect, test } from "vitest";
import {
  boardQueries,
  createApiHttp,
  createApiTokens,
  createApp,
  defaultSettings,
  nodeCrypto,
  type Actor,
  type CommandKey,
  type Instant,
  type MemberId,
  type PosInt,
  type ShopReader,
  type WorkspaceId,
} from "@propi/app";
import { createMemoryApiStores, createMemoryInsights, createMemoryPorts } from "@propi/app/testing";
import { apiReaders } from "../src/server/api-readers.ts";
import { handleApiRoute, MAX_BODY_BYTES } from "../src/server/api-route.ts";

const WS = "ws-api" as WorkspaceId;
const T0 = Date.UTC(2026, 10, 25, 15) as Instant;
const admin: Actor = { kind: "member", memberId: "boss" as MemberId, role: "admin" };
const BASE = "https://propi.test/api/v1";

function world() {
  const mem = createMemoryPorts({ now: T0 });
  mem.addWorkspace(WS, defaultSettings({ timezone: "America/Lima" }));
  for (const id of ["ana", "bob"]) mem.addMember(WS, { id: id as MemberId, role: "member", active: true, dailyLimitOverride: null });
  mem.addMember(WS, { id: "boss" as MemberId, role: "admin", active: true, dailyLimitOverride: null });
  const app = createApp(mem.ports);
  const stores = createMemoryApiStores(mem);
  const tokens = createApiTokens({ store: stores.tokens, crypto: nodeCrypto, clock: mem.ports.clock, ids: mem.ports.ids });
  const insights = createMemoryInsights(mem);
  const boards = boardQueries({ ports: mem.ports, source: insights.source });
  const http = createApiHttp({
    app,
    tokens,
    directory: mem.ports.directory,
    reader: mem.ports.reader,
    readers: apiReaders({
      gifts: (ws) => insights.source.gifts(ws),
      shop: (ws) => mem.ports.reader.workspace(ws) as unknown as ShopReader,
      quests: { quests: async () => [] },
      leaderboard: async (ws, q) => {
        const r = await boards.leaderboard(ws, null, q);
        return r.ok ? r.value : [];
      },
    }),
  });
  const issue = async (scopes: string[]) => {
    const r = await tokens.issue(admin, WS, { name: "erp", scopes });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  };
  const call = (method: string, path: string, opts: { token?: string; body?: string; idem?: string; headers?: Record<string, string> } = {}) =>
    handleApiRoute(
      new Request(`${BASE}${path}`, {
        method,
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          ...(opts.idem ? { "idempotency-key": opts.idem } : {}),
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...opts.headers,
        },
        ...(opts.body !== undefined ? { body: opts.body } : {}),
      }),
      http,
    );
  const exec = (k: string, cmd: Record<string, unknown> & { type: string }) => app.executeAny({ key: `test:${k}` as CommandKey, workspaceId: WS, actor: admin, at: T0, ...cmd });
  return { mem, app, tokens, issue, call, exec };
}

let w: ReturnType<typeof world>;
beforeEach(() => {
  w = world();
});

describe("S98 authentication and scopes", () => {
  test("no token → 401 unauthenticated", async () => {
    const res = await w.call("GET", "/members");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthenticated" } });
  });

  test("a revoked token → 401 token_revoked", async () => {
    const t = await w.issue(["members:read"]);
    await w.tokens.revoke(admin, WS, t.view.id);
    const res = await w.call("GET", "/members", { token: t.token });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("token_revoked");
  });

  test("a missing scope → 403 forbidden naming the scope", async () => {
    const t = await w.issue(["ledger:read"]);
    const res = await w.call("GET", "/members", { token: t.token });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "forbidden", need: "members:read" } });
  });

  test("an unknown route → 404 route_not_found", async () => {
    const t = await w.issue(["members:read"]);
    const res = await w.call("GET", "/nope", { token: t.token });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("route_not_found");
  });
});

describe("S97 reads", () => {
  test("members and balances", async () => {
    const t = await w.issue(["members:read", "ledger:read"]);
    await w.exec("bonus", { type: "GrantBonus", memberIds: ["ana"], amount: 5 as PosInt, reason: "hi" });
    const members = await w.call("GET", "/members", { token: t.token });
    expect(members.status).toBe(200);
    expect(members.headers.get("content-type")).toContain("application/json");
    expect((await members.json()).data.map((m: { id: string }) => m.id).sort()).toEqual(["ana", "bob", "boss"]);
    const bal = await w.call("GET", "/members/ana/balances", { token: t.token });
    expect(await bal.json()).toEqual({ data: { received: 0, given: 0, redeemable: 5 } });
    const unknown = await w.call("GET", "/members/zed", { token: t.token });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe("unknown_member");
  });

  test("gifts, rewards (no internal cost), redemptions, quests and leaderboards are wired (no 501)", async () => {
    const t = await w.issue(["ledger:read", "rewards:read", "redemptions:read", "quests:read", "leaderboards:read"]);
    await w.app.execute({
      key: "test:gift" as CommandKey,
      workspaceId: WS,
      actor: { kind: "member", memberId: "ana" as MemberId, role: "member" },
      at: T0,
      type: "GiveByMessage",
      messageRef: "m1",
      message: { channel: { id: "C1", kind: "public" }, text: "thanks :taco: :taco:", mentions: [{ kind: "member", memberId: "bob" as MemberId }], emojiTokens: [":taco:", ":taco:"], hashtags: [] },
    });
    const reward = await w.exec("reward", {
      type: "CreateReward",
      reward: { title: "Mug", description: "", image: null, cost: 10, stock: 3, variants: [], categories: ["swag"], internalCost: { minor: 900, currency: "PEN" }, instructions: "", autoApprove: false, giftCard: false },
    });
    if (!reward.ok) throw new Error(JSON.stringify(reward.error));
    const rewardId = (reward.value as { rewardId: string }).rewardId;
    await w.exec("activate", { type: "SetRewardStatus", rewardId, status: "active" });

    const gifts = await (await w.call("GET", "/gifts", { token: t.token })).json();
    expect(gifts.data).toHaveLength(1);
    expect(gifts.data[0]).toMatchObject({ giver: "ana", channel_id: "C1", created_at: new Date(T0).toISOString() });

    const rewards = await (await w.call("GET", "/rewards", { token: t.token })).json();
    expect(rewards.data).toHaveLength(1);
    expect(rewards.data[0]).toMatchObject({ id: rewardId, title: "Mug", cost: 10, stock: 3, internal_cost: null });
    expect((await w.call("GET", `/rewards/${rewardId}`, { token: t.token })).status).toBe(200);
    expect((await w.call("GET", "/rewards/missing", { token: t.token })).status).toBe(404);

    expect((await (await w.call("GET", "/redemptions", { token: t.token })).json()).data).toEqual([]);
    expect((await (await w.call("GET", "/quests", { token: t.token })).json()).data).toEqual([]);

    const board = await (await w.call("GET", "/leaderboards/received?timeframe=all", { token: t.token })).json();
    expect(board.data).toEqual([{ rank: 1, member_id: "bob", score: 2, received: 2, given: 0 }]);
    expect((await w.call("GET", "/leaderboards/bogus", { token: t.token })).status).toBe(404);
  });
});

describe("S100 writes and idempotency", () => {
  const bonus = JSON.stringify({ member_ids: ["ana"], amount: 5, reason: "erp" });

  test("a write without Idempotency-Key → 400 idempotency_key_required", async () => {
    const t = await w.issue(["adjustments:write"]);
    const res = await w.call("POST", "/bonuses", { token: t.token, body: bonus });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("idempotency_key_required");
  });

  test("the same key and body replays the first result and writes nothing new", async () => {
    const t = await w.issue(["adjustments:write"]);
    const first = await w.call("POST", "/bonuses", { token: t.token, body: bonus, idem: "erp-1" });
    expect(first.status).toBe(200);
    expect(first.headers.get("idempotent-replayed")).toBe("false");
    const again = await w.call("POST", "/bonuses", { token: t.token, body: bonus, idem: "erp-1" });
    expect(again.status).toBe(200);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(await again.json()).toEqual(await first.json());
    expect((await w.app.balances(WS, "ana" as MemberId)).redeemable).toBe(5);
  });

  test("the same key with a different body → 422 idempotency_key_reused", async () => {
    const t = await w.issue(["adjustments:write"]);
    await w.call("POST", "/bonuses", { token: t.token, body: bonus, idem: "erp-2" });
    const res = await w.call("POST", "/bonuses", { token: t.token, body: JSON.stringify({ member_ids: ["ana"], amount: 6, reason: "erp" }), idem: "erp-2" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("idempotency_key_reused");
    expect((await w.app.balances(WS, "ana" as MemberId)).redeemable).toBe(5);
  });

  test("S98: the token, not the admin who issued it, is the actor in the audit log (S40)", async () => {
    const t = await w.issue(["adjustments:write"]);
    await w.call("POST", "/deductions", { token: t.token, body: JSON.stringify({ member_id: "ana", amount: 1, reason: "fix" }), idem: "d-1" });
    const log = await w.app.auditLog(WS);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "deduction", reason: "fix", actor: { kind: "apiToken", tokenId: t.view.id } });
  });

  test("a business rejection → 422 with the domain code", async () => {
    const t = await w.issue(["adjustments:write"]);
    const res = await w.call("POST", "/deductions", { token: t.token, body: JSON.stringify({ member_id: "ana", amount: 1, reason: "" }), idem: "d-2" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("reason_required");
  });

  test("malformed JSON → 400 invalid_request; wrong JSON types → 400 with the field", async () => {
    const t = await w.issue(["adjustments:write"]);
    const bad = await w.call("POST", "/bonuses", { token: t.token, body: "{nope", idem: "b-1" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: { code: "invalid_request", field: "body" } });
    const typed = await w.call("POST", "/deductions", { token: t.token, body: JSON.stringify({ member_id: "ana", amount: "2", reason: "x" }), idem: "b-2" });
    expect(typed.status).toBe(400);
    expect((await typed.json()).error).toMatchObject({ code: "invalid_request", field: "amount" });
  });

  test("a body over the size limit → 413 before parsing", async () => {
    const t = await w.issue(["adjustments:write"]);
    const res = await w.call("POST", "/bonuses", { token: t.token, body: `{"x":"${"a".repeat(MAX_BODY_BYTES)}"}`, idem: "big" });
    expect(res.status).toBe(413);
  });

  test("S49 S53: approve then fulfil a redemption; fulfilling twice is a no-op", async () => {
    const t = await w.issue(["redemptions:write"]);
    const reward = await w.exec("r", { type: "CreateReward", reward: { title: "Mug", description: "", image: null, cost: 3, stock: null, variants: [], categories: [], internalCost: null, instructions: "", autoApprove: false, giftCard: false } });
    const rewardId = (reward as { ok: true; value: { rewardId: string } }).value.rewardId;
    await w.exec("a", { type: "SetRewardStatus", rewardId, status: "active" });
    await w.exec("f", { type: "GrantBonus", memberIds: ["ana"], amount: 3 as PosInt, reason: "fund" });
    const red = await w.app.execute({ key: "test:redeem" as CommandKey, workspaceId: WS, actor: { kind: "member", memberId: "ana" as MemberId, role: "member" }, at: T0, type: "Redeem", memberId: "ana" as MemberId, rewardId, variantId: null });
    if (!red.ok) throw new Error(JSON.stringify(red.error));
    const id = red.value.redemptionId;
    expect((await w.call("POST", `/redemptions/${id}/approve`, { token: t.token, body: "{}", idem: "ap" })).status).toBe(200);
    const f1 = await w.call("POST", `/redemptions/${id}/fulfil`, { token: t.token, body: "", idem: "fu-1" });
    expect(f1.status).toBe(200);
    const f2 = await w.call("POST", `/redemptions/${id}/fulfil`, { token: t.token, body: "", idem: "fu-2" });
    expect(f2.status).toBe(200);
    const shop = w.mem.ports.reader.workspace(WS) as unknown as ShopReader;
    await expect(shop.redemption(id)).resolves.toMatchObject({ state: "fulfilled" });
  });
});
