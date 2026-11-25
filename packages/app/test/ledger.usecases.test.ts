import { describe, expect, test } from "vitest";
import type { GiftId, PosInt } from "@propi/core";
import { T0, WS, admin, giveCmd, key, m, memberActor, mention, msg, setup } from "./setup.ts";

const bonus = (k: string, ids: string[], amount: number, reason = "launch") =>
  ({ type: "GrantBonus", key: key(k), workspaceId: WS, actor: admin, at: T0, memberIds: ids.map(m), amount: amount as PosInt, reason }) as const;
const deduct = (k: string, id: string, amount: number, reason = "fix") =>
  ({ type: "Deduct", key: key(k), workspaceId: WS, actor: admin, at: T0, memberId: m(id), amount: amount as PosInt, reason }) as const;
const reverse = (k: string, giftId: string, reason = "abuse") =>
  ({ type: "ReverseGift", key: key(k), workspaceId: WS, actor: admin, at: T0, giftId: giftId as GiftId, reason }) as const;
const reset = (k: string, reason = "new year") => ({ type: "ResetAllRedeemable", key: key(k), workspaceId: WS, actor: admin, at: T0, reason }) as const;

describe("admin adjustments through the app", () => {
  test("S36: a bonus to many members raises redeemable only", async () => {
    const { app, mem } = setup();
    const r = await app.execute(bonus("api:t:1", ["ana", "bob"], 5));
    expect(r).toEqual({ ok: true, replayed: false, value: { memberIds: ["ana", "bob"], amount: 5 } });
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 5 });
    expect(mem.entries(WS).map((e) => [e.kind, e.memberId, e.amount])).toEqual([["bonus", "ana", 5], ["bonus", "bob", 5]]);
    expect(mem.events(WS).map((e) => e.event.type)).toEqual(["adjustment.made"]);
    const denied = await app.execute({ ...bonus("api:t:2", ["ana"], 5), actor: memberActor("ana") });
    expect(denied).toEqual({ ok: false, replayed: false, error: { code: "forbidden", need: "admin" } });
    expect(mem.entries(WS)).toHaveLength(2);
  });

  test("S37: a deduction removes units from redeemable and needs a reason", async () => {
    const { app, mem } = setup();
    await app.execute(bonus("api:t:1", ["ana"], 5));
    expect(await app.execute(deduct("api:t:2", "ana", 2))).toEqual({ ok: true, replayed: false, value: { memberId: "ana", amount: 2 } });
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 3 });
    expect(await app.execute(deduct("api:t:3", "ana", 2, ""))).toEqual({ ok: false, replayed: false, error: { code: "reason_required" } });
    expect(mem.entries(WS)).toHaveLength(2);
  });

  test("S35: an admin deduction may drive redeemable negative", async () => {
    const { app } = setup();
    await app.execute(deduct("api:t:1", "ana", 4));
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 0, given: 0, redeemable: -4 });
  });

  test("S38: reversing a gift undoes received and given and does not restore the giver's allowance", async () => {
    const { app, mem } = setup();
    await app.execute(giveCmd("giver", msg("@Ana @Bob :taco::taco:", [mention("ana"), mention("bob")], 2)));
    const r = await app.execute(reverse("api:t:9", "gift-1"));
    expect(r).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", reversed: 4 } });
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 0 });
    expect(await app.balances(WS, m("giver"))).toEqual({ received: 0, given: 0, redeemable: 0 });
    expect(await app.allowance(WS, m("giver"))).toMatchObject({ used: 4, remaining: 1 });
    expect(mem.entries(WS).filter((e) => e.kind === "gift_reversal").every((e) => e.allowanceDay === null)).toBe(true);
    expect(mem.lockLog.at(-1)).toEqual([`gift:${mem.gifts(WS)[0]?.messageRef}`]);
  });

  test("S39: a bulk reset zeroes everyone's redeemable with one deduction each and keeps received", async () => {
    const { app, mem } = setup();
    await app.execute(giveCmd("giver", msg("@Ana :taco::taco::taco:", [mention("ana")], 3)));
    await app.execute(bonus("api:t:1", ["bob"], 4));
    const r = await app.execute(reset("api:t:2"));
    expect(r).toEqual({ ok: true, replayed: false, value: { members: 2, total: 7 } });
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 3, given: 0, redeemable: 0 });
    expect(await app.balances(WS, m("bob"))).toEqual({ received: 0, given: 0, redeemable: 0 });
    expect(mem.entries(WS).filter((e) => e.kind === "deduction").map((e) => [e.memberId, e.amount])).toEqual([["ana", 3], ["bob", 4]]);
    expect(mem.lockLog.at(-1)).toEqual(["member:ana", "member:bob", "member:boss", "member:diana", "member:giver", "member:gone", "member:lind"]);
  });

  test("S40: every admin adjustment appears in the audit log with actor, time and reason", async () => {
    const { app } = setup();
    await app.execute(bonus("api:t:1", ["ana"], 5, "launch"));
    await app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1)));
    await app.execute(deduct("api:t:2", "ana", 1, "typo"));
    expect(await app.auditLog(WS)).toEqual([
      { key: "api:t:1", action: "bonus", actor: admin, at: T0, reason: "launch", ok: true },
      { key: "api:t:2", action: "deduction", actor: admin, at: T0, reason: "typo", ok: true },
    ]);
  });

  test("S30: the ledger is append-only: reversals add rows and committed entries are immutable", async () => {
    const { app, mem } = setup();
    await app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1)));
    const before = mem.entries(WS)[0];
    await app.execute(reverse("api:t:1", "gift-1"));
    const after = mem.entries(WS);
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before);
    expect(Object.isFrozen(after[0])).toBe(true);
    expect(after.map((e) => [e.seq, e.kind, e.commandKey, e.ordinal])).toEqual([
      [1, "gift", after[0]?.commandKey, 0],
      [2, "gift_reversal", "api:t:1", 0],
    ]);
  });

  test("S34: the stored-query balances equal a full ledger replay", async () => {
    const { app } = setup();
    await app.execute(giveCmd("giver", msg("@Ana @Bob :taco::taco:", [mention("ana"), mention("bob")], 2)));
    await app.execute(bonus("api:t:1", ["ana"], 3));
    await app.execute(deduct("api:t:2", "bob", 1));
    await app.execute(reverse("api:t:3", "gift-1"));
    expect(await app.ledgerCheck(WS)).toEqual({ ok: true, members: 3, mismatches: [] });
  });

  test("S17: an API write retried with the same key returns the original result and writes once", async () => {
    const { app, mem } = setup();
    const first = await app.execute(bonus("api:t:1", ["ana"], 5));
    expect(await app.execute(bonus("api:t:1", ["ana"], 5))).toEqual({ ...first, replayed: true });
    expect(mem.entries(WS)).toHaveLength(1);
    const clash = await app.execute(bonus("api:t:1", ["ana"], 6));
    expect(clash.ok === false && clash.error.code).toBe("idempotency_key_reused");
  });

  test("S39: a bulk reset and a deduction at once are serialized and never double-deduct", async () => {
    const { app } = setup();
    await app.execute(bonus("api:t:1", ["ana"], 5));
    await Promise.all([app.execute(reset("api:t:2")), app.execute(deduct("api:t:3", "ana", 2))]);
    const b = await app.balances(WS, m("ana"));
    expect([0, -2]).toContain(b.redeemable);
  });
});

describe("entry amount cap (MAX_ENTRY_AMOUNT)", () => {
  test("S36: two 2e9 bonuses are refused with amount_too_large and write nothing, so no balance can overflow", async () => {
    const { app, mem } = setup();
    for (const k of ["api:big:1", "api:big:2"]) {
      expect(await app.execute(bonus(k, ["ana"], 2_000_000_000))).toEqual({ ok: false, replayed: false, error: { code: "amount_too_large", max: 1_000_000 } });
    }
    expect(mem.entries(WS)).toEqual([]);
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 0 });
    // The refusal is stored under its key like any other result (G2).
    expect(mem.commandLog(WS).map((r) => r.result)).toEqual([
      { ok: false, error: { code: "amount_too_large", max: 1_000_000 } },
      { ok: false, error: { code: "amount_too_large", max: 1_000_000 } },
    ]);
  });

  test("S30: createApp refuses any handler's decision with an entry above the cap, before commit", async () => {
    const { createApp, defineHandler, accept } = await import("../src/index.ts");
    const { mem } = setup();
    const huge = defineHandler<{ type: "PayHuge"; key: ReturnType<typeof key>; workspaceId: typeof WS; actor: typeof admin; at: typeof T0 }, null, { paid: number }>({
      type: "PayHuge",
      locks: () => [`member:${m("ana")}`],
      load: async () => null,
      decide: () => accept({ paid: 3_000_000 }, { entries: [{ kind: "bonus", amount: 3_000_000 as PosInt, memberId: m("ana"), counterpartId: null, cause: { type: "admin" }, source: null, allowanceDay: null, reason: "plugin" }] }),
    });
    const app = createApp(mem.ports, { handlers: [huge] });
    expect(await app.executeAny({ type: "PayHuge", key: key("plugin:1"), workspaceId: WS, actor: admin, at: T0 })).toEqual({
      ok: false,
      replayed: false,
      error: { code: "amount_too_large", max: 1_000_000 },
    });
    expect(mem.entries(WS)).toEqual([]);
  });
});
