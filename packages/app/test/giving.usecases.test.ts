import { describe, expect, test } from "vitest";
import type { PosInt, ValueId } from "@propi/core";
import { NEXT_DAY, T0, WS, giveCmd, key, m, memberActor, mention, msg, reactCmd, setup, unreactCmd } from "./setup.ts";

describe("giving by message", () => {
  test("S9: a gift message credits each receiver, records the ledger and emits gift.given", async () => {
    const { app, mem } = setup();
    const r = await app.execute(giveCmd("giver", msg("@Lind gracias por la sesión :taco: :taco: :taco:", [mention("lind")], 3), "T:C1:s9"));
    expect(r).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", receivers: ["lind"], perReceiver: 3, totalCost: 3, remainingAllowance: 2 } });
    expect(mem.entries(WS).map((e) => [e.kind, e.memberId, e.counterpartId, e.amount, e.allowanceDay])).toEqual([["gift", "lind", "giver", 3, "2026-11-25"]]);
    expect(mem.events(WS).map((e) => e.event.type)).toEqual(["gift.given"]);
    expect(await app.balances(WS, m("lind"))).toEqual({ received: 3, given: 0, redeemable: 3 });
    expect(await app.balances(WS, m("giver"))).toEqual({ received: 0, given: 3, redeemable: 0 });
  });

  test("S10: two receivers cost the giver amount x 2", async () => {
    const { app, mem } = setup();
    const r = await app.execute(giveCmd("giver", msg("@Ana @Diana :taco::taco:", [mention("ana"), mention("diana")], 2)));
    expect(r.ok && r.value).toMatchObject({ totalCost: 4, remainingAllowance: 1 });
    expect(mem.entries(WS)).toHaveLength(2);
    expect(await app.allowance(WS, m("giver"))).toEqual({ day: "2026-11-25", limit: 5, used: 4, remaining: 1 });
  });

  test("S11: a message whose only receiver is the giver moves nothing", async () => {
    const { app, mem } = setup();
    const r = await app.execute(giveCmd("giver", msg("@me :taco:", [mention("giver")], 1)));
    expect(r).toEqual({ ok: false, replayed: false, error: { code: "not_a_gift" } });
    expect(mem.entries(WS)).toEqual([]);
    expect(mem.events(WS)).toEqual([]);
  });

  test("S12: a group mention pays every active group member except the giver", async () => {
    const { app, mem } = setup();
    const group = { kind: "group", groupId: "S9", memberIds: [m("ana"), m("giver"), m("gone"), m("bob")] } as const;
    const r = await app.execute(giveCmd("giver", msg("@team :taco:", [group], 1)));
    expect(r.ok && r.value.receivers).toEqual(["ana", "bob"]);
    expect(mem.entries(WS).map((e) => e.memberId)).toEqual(["ana", "bob"]);
  });

  test("S13: over the allowance nothing moves, the rejection is logged and the giver gets one notice", async () => {
    const { app, mem } = setup();
    const cmd = giveCmd("giver", msg("@Ana @Diana @Lind :taco::taco:", [mention("ana"), mention("diana"), mention("lind")], 2));
    const r = await app.execute(cmd);
    expect(r).toEqual({ ok: false, replayed: false, error: { code: "over_allowance", cost: 6, remaining: 5 } });
    expect(mem.entries(WS)).toEqual([]);
    expect(mem.events(WS).map((e) => e.event)).toEqual([{ type: "gift.rejected", giver: "giver", error: { code: "over_allowance", cost: 6, remaining: 5 } }]);
    // A retried event does not notify twice.
    expect(await app.execute(cmd)).toEqual({ ok: false, replayed: true, error: { code: "over_allowance", cost: 6, remaining: 5 } });
    expect(mem.events(WS)).toHaveLength(1);
  });

  test("S14: the gift keeps the whole message text as its reason", async () => {
    const { app, mem } = setup();
    await app.execute(giveCmd("giver", msg("@Ana thanks for the deploy :taco:", [mention("ana")], 1), "T:C1:s14"));
    expect(mem.gifts(WS)[0]).toMatchObject({ messageRef: "T:C1:s14", text: "@Ana thanks for the deploy :taco:", source: "message" });
    expect(mem.entries(WS)[0]?.reason).toBe("@Ana thanks for the deploy :taco:");
  });

  test("S15: hashtags tag the gift with workspace values", async () => {
    const { app, mem } = setup();
    mem.setValues(WS, [{ id: "v-own" as ValueId, name: "Ownership", hashtag: "#ownership", emoji: null }]);
    await app.execute(giveCmd("giver", msg("@Ana :taco: #ownership", [mention("ana")], 1, { hashtags: ["#ownership"] })));
    expect(mem.gifts(WS)[0]?.valueIds).toEqual(["v-own"]);
  });

  test("S4: currency changes apply only to future gifts; past entries keep their amounts", async () => {
    const fire = new Map([[":fire:", 3 as PosInt]]);
    const { app, mem } = setup();
    mem.updateSettings(WS, (s) => ({ ...s, currency: { ...s.currency, extraEmojis: fire } }));
    await app.execute(giveCmd("giver", msg("@Ana :fire:", [mention("ana")], [":fire:"])));
    mem.updateSettings(WS, (s) => ({ ...s, currency: { ...s.currency, plural: "beans", extraEmojis: new Map([[":fire:", 1 as PosInt]]) } }));
    await app.execute(giveCmd("giver", msg("@Ana :fire:", [mention("ana")], [":fire:"])));
    expect(mem.entries(WS).map((e) => e.amount)).toEqual([3, 1]);
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 4, given: 0, redeemable: 4 });
  });

  test("S17: the same event processed twice gives the same result once, and a reused key with another payload is refused", async () => {
    const { app, mem } = setup();
    const cmd = giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1), "T:C1:s17");
    const first = await app.execute(cmd);
    const second = await app.execute(cmd);
    expect(second).toEqual({ ...first, replayed: true });
    expect(mem.entries(WS)).toHaveLength(1);
    expect(mem.events(WS)).toHaveLength(1);
    const reused = await app.execute({ ...cmd, message: msg("@Bob :taco:", [mention("bob")], 1) });
    expect(reused.ok === false && reused.error.code).toBe("idempotency_key_reused");
    expect(mem.entries(WS)).toHaveLength(1);
  });

  test("S17: the same event delivered twice at once writes once and both callers get the same result", async () => {
    const { app, mem } = setup();
    const cmd = giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1));
    const [a, b] = await Promise.all([app.execute(cmd), app.execute(cmd)]);
    expect(a?.ok && b?.ok && a.value).toEqual(b?.ok && b.value);
    expect([a?.replayed, b?.replayed].sort()).toEqual([false, true]);
    expect(mem.entries(WS)).toHaveLength(1);
  });

  test("S25: a per-member override sets that member's daily limit", async () => {
    const { app, mem } = setup();
    mem.addMember(WS, { id: m("giver"), role: "member", active: true, dailyLimitOverride: 8 as PosInt });
    expect(await app.allowance(WS, m("giver"))).toMatchObject({ limit: 8, remaining: 8 });
    const r = await app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 7)));
    expect(r.ok && r.value.remainingAllowance).toBe(1);
  });

  test("S26: admins get the admin default allowance", async () => {
    const { app, mem } = setup({ settings: { adminDailyAllowance: 12 as PosInt } });
    expect(await app.allowance(WS, m("boss"))).toMatchObject({ limit: 12 });
    expect(mem.entries(WS)).toEqual([]);
  });

  test("S27: allowance resets at local midnight and unused allowance does not carry over", async () => {
    const { app, mem } = setup();
    await app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 5)));
    expect((await app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1)))).ok).toBe(false);
    mem.clock.set(Date.UTC(2026, 10, 26, 5, 1, 0)); // 00:01 Lima on the 26th
    expect(await app.allowance(WS, m("giver"))).toEqual({ day: "2026-11-26", limit: 5, used: 0, remaining: 5 });
    const r = await app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 5)));
    expect(r.ok && r.value.remainingAllowance).toBe(0);
  });

  test("S28: a member can see their remaining allowance at any time", async () => {
    const { app } = setup();
    expect(await app.allowance(WS, m("giver"))).toEqual({ day: "2026-11-25", limit: 5, used: 0, remaining: 5 });
    await app.execute(giveCmd("giver", msg("@Ana :taco::taco:", [mention("ana")], 2)));
    expect(await app.allowance(WS, m("giver"))).toEqual({ day: "2026-11-25", limit: 5, used: 2, remaining: 3 });
  });

  test("S29: every successful gift emits a confirmation event with the remaining allowance", async () => {
    const { app, mem } = setup();
    await app.execute(giveCmd("giver", msg("@Ana :taco::taco:", [mention("ana")], 2)));
    expect(mem.events(WS).map((e) => e.event)).toEqual([
      { type: "gift.given", giftId: "gift-1", giver: "giver", receivers: ["ana"], perReceiver: 2, totalCost: 2, remainingAllowance: 3, source: "message" },
    ]);
  });

  test("S7: a deactivated member neither gives nor receives", async () => {
    const { app, mem } = setup();
    expect(await app.execute(giveCmd("gone", msg("@Ana :taco:", [mention("ana")], 1)))).toEqual({ ok: false, replayed: false, error: { code: "inactive_member" } });
    expect(await app.execute(giveCmd("giver", msg("@Gone :taco:", [mention("gone")], 1)))).toEqual({ ok: false, replayed: false, error: { code: "not_a_gift" } });
    expect(mem.entries(WS)).toEqual([]);
  });

  test("S19: 20 parallel gifts from one giver with allowance 5 give exactly 5 (serialized by the member lock)", async () => {
    const { app, mem } = setup();
    const results = await Promise.all(Array.from({ length: 20 }, () => app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1)))));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.error.code === "over_allowance")).toHaveLength(15);
    expect(await app.balances(WS, m("giver"))).toMatchObject({ given: 5 });
    expect(mem.entries(WS)).toHaveLength(5);
  });

  test("the race is real: without the mutex the same 20 parallel gifts overspend", async () => {
    const { app } = setup({ locking: false });
    await Promise.all(Array.from({ length: 20 }, () => app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1)))));
    expect((await app.balances(WS, m("giver"))).given).toBeGreaterThan(5);
  });

  test("execute declares sorted locks, claims the key, then loads and decides", async () => {
    const { app, mem } = setup();
    const cmd = giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1), "T:C1:locks");
    await app.execute(cmd);
    expect(mem.lockLog.at(-1)).toEqual(["gift:T:C1:locks", "member:giver"]);
    const idsBefore = mem.idsIssued();
    await app.execute(cmd); // replay: no load, so no new id
    expect(mem.idsIssued()).toBe(idsBefore);
  });
});

describe("giving by reaction", () => {
  test("S18: a reaction gives the emoji value to the reacted message's author when it mentions nobody", async () => {
    const { app, mem } = setup();
    const r = await app.execute(reactCmd("giver", "T:C1:r1", { author: "lind" }));
    expect(r).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", receivers: ["lind"], perReceiver: 1, totalCost: 1, remainingAllowance: 4 } });
    expect(mem.entries(WS).map((e) => [e.kind, e.memberId, e.source])).toEqual([["gift", "lind", "reaction"]]);
    const toMentions = await app.execute(reactCmd("giver", "T:C1:r2", { author: "lind", mentions: [mention("ana"), mention("bob")] }));
    expect(toMentions.ok && toMentions.value.receivers).toEqual(["ana", "bob"]);
  });

  test("S19: a reaction gift consumes the reactor's allowance", async () => {
    const { app } = setup();
    await app.execute(reactCmd("giver", "T:C1:r1", { author: "lind" }));
    expect(await app.allowance(WS, m("giver"))).toMatchObject({ used: 1, remaining: 4 });
  });

  test("S20: the same giver reacting twice with the same emoji counts once; removing and re-adding the same day gives again (G8)", async () => {
    const { app, mem } = setup();
    await app.execute(reactCmd("giver", "T:C1:r1", { author: "lind" }));
    const again = await app.execute(reactCmd("giver", "T:C1:r1", { author: "lind" }));
    expect(again.replayed).toBe(true);
    expect(mem.entries(WS)).toHaveLength(1);
    await app.execute(unreactCmd("giver", "T:C1:r1"));
    const readd = await app.execute(reactCmd("giver", "T:C1:r1", { author: "lind" }));
    expect(readd).toMatchObject({ ok: true, replayed: false });
    expect(mem.entries(WS).map((e) => e.kind)).toEqual(["gift", "gift_reversal", "gift"]);
    expect(await app.balances(WS, m("lind"))).toMatchObject({ received: 1 });
    expect(mem.commandLog(WS).map((r) => r.key)).toEqual([
      "slack:react:T:C1:r1:giver::taco::0",
      "slack:unreact:T:C1:r1:giver::taco::0",
      "slack:react:T:C1:r1:giver::taco::1",
    ]);
  });

  test("S21: removing a reaction the same day reverses it and returns the allowance; the next day it changes nothing", async () => {
    const { app, mem } = setup();
    await app.execute(reactCmd("giver", "T:C1:r1", { author: "lind" }));
    const r = await app.execute(unreactCmd("giver", "T:C1:r1"));
    expect(r).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", reversed: 1, allowanceRestored: 1 } });
    expect(await app.allowance(WS, m("giver"))).toMatchObject({ used: 0, remaining: 5 });
    expect(await app.balances(WS, m("lind"))).toEqual({ received: 0, given: 0, redeemable: 0 });

    await app.execute(reactCmd("bob", "T:C1:r9", { author: "lind" }));
    mem.clock.set(NEXT_DAY);
    const late = await app.execute(unreactCmd("bob", "T:C1:r9"));
    expect(late).toEqual({ ok: true, replayed: false, value: { giftId: "gift-2", reversed: 0, allowanceRestored: 0 } });
    expect(await app.balances(WS, m("lind"))).toMatchObject({ received: 1 });
  });

  test("S22: nobody can react-gift their own message when they are its only receiver", async () => {
    const { app, mem } = setup();
    const r = await app.execute(reactCmd("lind", "T:C1:r1", { author: "lind" }));
    expect(r).toEqual({ ok: false, replayed: false, error: { code: "not_a_gift" } });
    expect(mem.entries(WS)).toEqual([]);
  });
});

describe("edits and deletions", () => {
  const edit = (ref: string, editTs: string, text: string, mentions: ReturnType<typeof mention>[], tacos: number) =>
    ({ type: "EditMessage", key: key(`slack:edit:${ref}:${editTs}`), workspaceId: WS, actor: memberActor("giver"), at: T0, messageRef: ref, message: msg(text, mentions, tacos) }) as const;
  const del = (ref: string) => ({ type: "DeleteMessage", key: key(`slack:del:${ref}`), workspaceId: WS, actor: memberActor("giver"), at: T0, messageRef: ref }) as const;

  test("S23: an edit that newly qualifies becomes a gift at edit time", async () => {
    const { app, mem } = setup();
    await app.execute(giveCmd("giver", msg("@Ana thanks", [mention("ana")], 0), "T:C1:e1"));
    expect(mem.entries(WS)).toEqual([]);
    const r = await app.execute(edit("T:C1:e1", "2", "@Ana thanks :taco:", [mention("ana")], 1));
    const created = mem.gifts(WS)[0];
    expect(created).toMatchObject({ messageRef: "T:C1:e1", text: "@Ana thanks :taco:" });
    expect(r).toEqual({ ok: true, replayed: false, value: { giftId: created?.id, added: 1, reversed: 0, remainingAllowance: 4 } });
    expect(mem.entries(WS).map((e) => [e.kind, e.memberId, e.amount, e.commandKey])).toEqual([["gift", "ana", 1, "slack:edit:T:C1:e1:2"]]);
    expect(await app.balances(WS, m("ana"))).toMatchObject({ received: 1 });
  });

  test("S23: editing a gift recomputes it, applying the difference as reversal or top-up", async () => {
    const { app, mem } = setup();
    await app.execute(giveCmd("giver", msg("@Ana @Diana :taco::taco:", [mention("ana"), mention("diana")], 2), "T:C1:e2"));
    const r = await app.execute(edit("T:C1:e2", "2", "@Ana :taco::taco::taco:", [mention("ana")], 3));
    expect(r).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", added: 1, reversed: 2, remainingAllowance: 2 } });
    expect(await app.balances(WS, m("ana"))).toMatchObject({ received: 3 });
    expect(await app.balances(WS, m("diana"))).toMatchObject({ received: 0 });
    expect(await app.allowance(WS, m("giver"))).toMatchObject({ used: 3 });
    expect(mem.gifts(WS)[0]?.text).toBe("@Ana :taco::taco::taco:");
  });

  test("S24: deleting a gift message the same day reverses it and returns the allowance; the next day it stands", async () => {
    const { app, mem } = setup();
    await app.execute(giveCmd("giver", msg("@Ana :taco::taco:", [mention("ana")], 2), "T:C1:d1"));
    expect(await app.execute(del("T:C1:d1"))).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", reversed: 2, allowanceRestored: 2 } });
    expect(await app.allowance(WS, m("giver"))).toMatchObject({ used: 0 });
    expect(await app.balances(WS, m("ana"))).toMatchObject({ received: 0 });

    await app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1), "T:C1:d2"));
    mem.clock.set(NEXT_DAY);
    expect(await app.execute(del("T:C1:d2"))).toEqual({ ok: true, replayed: false, value: { giftId: "gift-2", reversed: 0, allowanceRestored: 0 } });
    expect(await app.balances(WS, m("ana"))).toMatchObject({ received: 1 });
  });
});
