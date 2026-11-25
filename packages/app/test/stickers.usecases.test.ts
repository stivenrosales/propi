import { describe, expect, test } from "vitest";
import type { Instant, PosInt } from "@propi/core";
import { engagementSetup } from "./engagement.setup.ts";
import { T0, WS, admin, key, m, memberActor, mention } from "./setup.ts";

const base = (k: string) => ({ key: key(k), workspaceId: WS, at: T0 });
const enable = { ...base("api:stickers:on"), type: "ConfigureStickers", actor: admin, enabled: true } as const;
const defineTruck = { ...base("api:sticker:truck"), type: "DefineSticker", actor: admin, sticker: { id: "truck", name: "Truck", image: null, receivers: 5 as PosInt, unitsPerReceiver: 2 as PosInt } } as const;
const give = (k: string, who = "giver", receivers = ["ana", "bob"]) =>
  ({
    ...base(k),
    type: "GiveSticker",
    actor: memberActor(who),
    messageRef: `T:C1:${k}`,
    stickerId: "truck",
    channel: { id: "C1", kind: "public" },
    mentions: receivers.map(mention),
    channelMembers: [],
  }) as const;

async function withTruck() {
  const ctx = engagementSetup();
  await ctx.run(enable);
  await ctx.run(defineTruck);
  return ctx;
}

describe("stickers through the app", () => {
  test("S73: the module is OFF by default", async () => {
    const { run, mem } = engagementSetup();
    await run(defineTruck);
    expect(await run(give("slack:st:1"))).toEqual({ ok: false, replayed: false, error: { code: "module_disabled" } });
    expect(mem.entries(WS)).toEqual([]);
  });

  test("S74: a sticker gift counts to received and does not consume the giver's allowance", async () => {
    const { run, app, mem } = await withTruck();
    const r = await run(give("slack:st:1"));
    expect(r).toMatchObject({ ok: true, value: { receivers: ["ana", "bob"], perReceiver: 2, totalCost: 4, remainingAllowance: null, usesLeft: 0 } });
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 2, given: 0, redeemable: 2 });
    expect(await app.balances(WS, m("giver"))).toEqual({ received: 0, given: 4, redeemable: 0 });
    expect(await app.allowance(WS, m("giver"))).toMatchObject({ used: 0, remaining: 5 });
    expect(mem.gifts(WS)).toMatchObject([{ source: "sticker", allowanceDay: null }]);
    expect(mem.events(WS).at(-1)?.event).toMatchObject({ type: "gift.given", source: "sticker", remainingAllowance: null });
    expect(mem.lockLog.at(-1)).toEqual(["gift:T:C1:slack:st:1", "member:giver"]);
  });

  test("S75: the monthly quota resets at the start of the month in the workspace timezone", async () => {
    const { run, mem } = await withTruck();
    mem.clock.set(Date.UTC(2026, 11, 1, 4, 0) as Instant); // Nov 30, 23:00 in Lima
    expect((await run(give("slack:st:1"))).ok).toBe(true);
    expect(await run(give("slack:st:2"))).toMatchObject({ ok: false, error: { code: "quota_exhausted", used: 1, available: 1 } });
    mem.clock.set(Date.UTC(2026, 11, 1, 5, 0) as Instant); // Dec 1, 00:00 in Lima
    expect((await run(give("slack:st:3"))).ok).toBe(true);
  });

  test("S76: an admin grants extra uses", async () => {
    const { run } = await withTruck();
    await run(give("slack:st:1"));
    const grant = { ...base("api:grant:1"), type: "GrantStickerUses", actor: admin, memberId: m("giver"), stickerId: "truck", uses: 2 as PosInt } as const;
    expect(await run(grant)).toEqual({ ok: true, replayed: false, value: { month: "2026-11", uses: 2 } });
    expect((await run(give("slack:st:2"))).ok).toBe(true);
    expect((await run(give("slack:st:3"))).ok).toBe(true);
    expect(await run(give("slack:st:4"))).toMatchObject({ ok: false, error: { code: "quota_exhausted", used: 3, available: 3 } });
  });

  test("S75: parallel sticker gifts by one giver never exceed the quota", async () => {
    const { run, mem } = await withTruck();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => run(give(`slack:st:p${i}`))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(mem.entries(WS).filter((e) => e.source === "sticker")).toHaveLength(2);
  });
});
