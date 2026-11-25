// Port contract: the giving and adjustment scenarios of the app use-case tests, run through
// createApp() against the in-memory ports and against real Postgres. Both must behave the same.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { GiftId, PosInt, ValueId, WorkspaceId } from "@propi/core";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./pg.ts";
import { NEXT_DAY, T0, admin, key, m, memberActor, memoryBackend, mention, msg, postgresBackend, type Backend } from "./harness.ts";
import type { InboundMessage, Mention } from "@propi/core";

let db: TestDatabase | undefined;
let pgClient: ReturnType<TestDatabase["client"]> | undefined;

beforeAll(async () => {
  if (hasDatabase) {
    db = await createTestDatabase();
    pgClient = db.client();
  }
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

const backends: [string, Backend, boolean][] = [
  ["memory", memoryBackend, false],
  [
    "postgres",
    postgresBackend(() => {
      if (pgClient === undefined) throw new Error("no database");
      return pgClient;
    }),
    !hasDatabase,
  ],
];

// ───────────── Command builders (workspace-scoped) ─────────────

let n = 0;
const giveCmd = (ws: WorkspaceId, from: string, message: InboundMessage, ref = `T:C1:${++n}`) =>
  ({ type: "GiveByMessage", key: key(`slack:msg:${ref}`), workspaceId: ws, actor: memberActor(from), at: T0, messageRef: ref, message }) as const;
const reactCmd = (ws: WorkspaceId, from: string, ref: string, target: { author: string; mentions?: Mention[] }, emoji = ":taco:") =>
  ({
    type: "GiveByReaction",
    key: key(`slack:react:${ref}:${from}:${emoji}`),
    workspaceId: ws,
    actor: memberActor(from),
    at: T0,
    messageRef: ref,
    emoji,
    channel: { id: "C1", kind: "public" },
    target: { author: m(target.author), mentions: target.mentions ?? [] },
  }) as const;
const unreactCmd = (ws: WorkspaceId, from: string, ref: string, emoji = ":taco:") =>
  ({ type: "RemoveReaction", key: key(`slack:unreact:${ref}:${from}:${emoji}`), workspaceId: ws, actor: memberActor(from), at: T0, messageRef: ref, emoji }) as const;
const editCmd = (ws: WorkspaceId, ref: string, editTs: string, text: string, mentions: Mention[], tacos: number) =>
  ({ type: "EditMessage", key: key(`slack:edit:${ref}:${editTs}`), workspaceId: ws, actor: memberActor("giver"), at: T0, messageRef: ref, message: msg(text, mentions, tacos) }) as const;
const delCmd = (ws: WorkspaceId, ref: string) =>
  ({ type: "DeleteMessage", key: key(`slack:del:${ref}`), workspaceId: ws, actor: memberActor("giver"), at: T0, messageRef: ref }) as const;
const bonus = (ws: WorkspaceId, k: string, ids: string[], amount: number, reason = "launch") =>
  ({ type: "GrantBonus", key: key(k), workspaceId: ws, actor: admin, at: T0, memberIds: ids.map(m), amount: amount as PosInt, reason }) as const;
const deduct = (ws: WorkspaceId, k: string, id: string, amount: number, reason = "fix") =>
  ({ type: "Deduct", key: key(k), workspaceId: ws, actor: admin, at: T0, memberId: m(id), amount: amount as PosInt, reason }) as const;
const reverse = (ws: WorkspaceId, k: string, giftId: string, reason = "abuse") =>
  ({ type: "ReverseGift", key: key(k), workspaceId: ws, actor: admin, at: T0, giftId: giftId as GiftId, reason }) as const;
const reset = (ws: WorkspaceId, k: string, reason = "new year") => ({ type: "ResetAllRedeemable", key: key(k), workspaceId: ws, actor: admin, at: T0, reason }) as const;

describe.each(backends)("port contract: %s", (_name, backend, skip) => {
  describe.skipIf(skip)("giving", () => {
    test("S9: a gift message credits each receiver, records the ledger and emits gift.given", async () => {
      const h = await backend();
      const r = await h.app.execute(giveCmd(h.ws, "giver", msg("@Lind gracias :taco: :taco: :taco:", [mention("lind")], 3), "T:C1:s9"));
      expect(r).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", receivers: ["lind"], perReceiver: 3, totalCost: 3, remainingAllowance: 2 } });
      expect((await h.entries()).map((e) => [e.kind, e.memberId, e.counterpartId, e.amount, e.allowanceDay, e.source, e.cause])).toEqual([
        ["gift", "lind", "giver", 3, "2026-11-25", "message", { type: "gift", giftId: "gift-1" }],
      ]);
      expect((await h.events()).map((e) => e.type)).toEqual(["gift.given"]);
      expect(await h.app.balances(h.ws, m("lind"))).toEqual({ received: 3, given: 0, redeemable: 3 });
      expect(await h.app.balances(h.ws, m("giver"))).toEqual({ received: 0, given: 3, redeemable: 0 });
    });

    test("S10: two receivers cost the giver amount x 2", async () => {
      const h = await backend();
      const r = await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana @Diana :taco::taco:", [mention("ana"), mention("diana")], 2)));
      expect(r.ok && r.value).toMatchObject({ totalCost: 4, remainingAllowance: 1 });
      expect(await h.entries()).toHaveLength(2);
      expect(await h.app.allowance(h.ws, m("giver"))).toEqual({ day: "2026-11-25", limit: 5, used: 4, remaining: 1 });
    });

    test("S12: a group mention pays every active group member except the giver", async () => {
      const h = await backend();
      const group = { kind: "group", groupId: "S9", memberIds: [m("ana"), m("giver"), m("gone"), m("bob")] } as const;
      const r = await h.app.execute(giveCmd(h.ws, "giver", msg("@team :taco:", [group], 1)));
      expect(r.ok && r.value.receivers).toEqual(["ana", "bob"]);
      expect((await h.entries()).map((e) => e.memberId)).toEqual(["ana", "bob"]);
    });

    test("S13: over the allowance nothing moves, the rejection is logged and a retry does not notify twice", async () => {
      const h = await backend();
      const cmd = giveCmd(h.ws, "giver", msg("@Ana @Diana @Lind :taco::taco:", [mention("ana"), mention("diana"), mention("lind")], 2));
      expect(await h.app.execute(cmd)).toEqual({ ok: false, replayed: false, error: { code: "over_allowance", cost: 6, remaining: 5 } });
      expect(await h.entries()).toEqual([]);
      expect(await h.events()).toEqual([{ type: "gift.rejected", giver: "giver", error: { code: "over_allowance", cost: 6, remaining: 5 } }]);
      expect(await h.app.execute(cmd)).toEqual({ ok: false, replayed: true, error: { code: "over_allowance", cost: 6, remaining: 5 } });
      expect(await h.events()).toHaveLength(1);
    });

    test("S14, S15: the gift keeps the message text and its value tags", async () => {
      const h = await backend();
      await h.setValues([
        { id: "v-own" as ValueId, name: "Ownership", hashtag: "#ownership", emoji: null },
        { id: "v-fun" as ValueId, name: "Fun", hashtag: null, emoji: ":tada:" },
      ]);
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana deploy :taco: #ownership :tada:", [mention("ana")], [":taco:", ":tada:"], { hashtags: ["#ownership"] }), "T:C1:s14"));
      const [gift] = await h.gifts();
      expect(gift).toEqual({
        id: "gift-1",
        giver: "giver",
        messageRef: "T:C1:s14",
        source: "message",
        emoji: null,
        channelId: "C1",
        isPrivate: false,
        text: "@Ana deploy :taco: #ownership :tada:",
        valueIds: ["v-own", "v-fun"],
        allowanceDay: "2026-11-25",
        createdAt: T0,
        closedBy: null,
      });
      expect((await h.entries())[0]?.reason).toBe("@Ana deploy :taco: #ownership :tada:");
    });

    test("S4: currency changes apply only to future gifts", async () => {
      const h = await backend();
      await h.updateSettings((s) => ({ ...s, currency: { ...s.currency, extraEmojis: new Map([[":fire:", 3 as PosInt]]) } }));
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :fire:", [mention("ana")], [":fire:"])));
      await h.updateSettings((s) => ({ ...s, currency: { ...s.currency, plural: "beans", extraEmojis: new Map([[":fire:", 1 as PosInt]]) } }));
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :fire:", [mention("ana")], [":fire:"])));
      expect((await h.entries()).map((e) => e.amount)).toEqual([3, 1]);
      expect(await h.app.balances(h.ws, m("ana"))).toEqual({ received: 4, given: 0, redeemable: 4 });
    });

    test("S17: the same event twice gives the same result once; a reused key with another payload is refused", async () => {
      const h = await backend();
      const cmd = giveCmd(h.ws, "giver", msg("@Ana :taco:", [mention("ana")], 1), "T:C1:s17");
      const first = await h.app.execute(cmd);
      expect(await h.app.execute(cmd)).toEqual({ ...first, replayed: true });
      expect(await h.entries()).toHaveLength(1);
      expect(await h.events()).toHaveLength(1);
      const reused = await h.app.execute({ ...cmd, message: msg("@Bob :taco:", [mention("bob")], 1) });
      expect(reused.ok === false && reused.error.code).toBe("idempotency_key_reused");
      expect(await h.entries()).toHaveLength(1);
      expect((await h.commandLog()).map((r) => [r.key, r.commandType, r.actor, r.at, r.result])).toEqual([["slack:msg:T:C1:s17", "GiveByMessage", memberActor("giver"), T0, { ok: true, value: first.ok && first.value }]]);
    });

    test("S7: a deactivated member neither gives nor receives", async () => {
      const h = await backend();
      expect(await h.app.execute(giveCmd(h.ws, "gone", msg("@Ana :taco:", [mention("ana")], 1)))).toEqual({ ok: false, replayed: false, error: { code: "inactive_member" } });
      expect(await h.app.execute(giveCmd(h.ws, "giver", msg("@Gone :taco:", [mention("gone")], 1)))).toEqual({ ok: false, replayed: false, error: { code: "not_a_gift" } });
      expect(await h.entries()).toEqual([]);
    });

    test("S25, S26: per-member override and admin default set the daily limit", async () => {
      const h = await backend({ adminDailyAllowance: 12 as PosInt });
      await h.addMember({ id: m("giver"), role: "member", active: true, dailyLimitOverride: 8 as PosInt });
      expect(await h.app.allowance(h.ws, m("giver"))).toMatchObject({ limit: 8, remaining: 8 });
      expect(await h.app.allowance(h.ws, m("boss"))).toMatchObject({ limit: 12 });
      const r = await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :taco:", [mention("ana")], 7)));
      expect(r.ok && r.value.remainingAllowance).toBe(1);
    });

    test("S27, S28: allowance resets at local midnight and is visible at any time", async () => {
      const h = await backend();
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :taco:", [mention("ana")], 5)));
      expect(await h.app.allowance(h.ws, m("giver"))).toEqual({ day: "2026-11-25", limit: 5, used: 5, remaining: 0 });
      expect((await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :taco:", [mention("ana")], 1)))).ok).toBe(false);
      h.setNow(Date.UTC(2026, 10, 26, 5, 1, 0)); // 00:01 Lima on the 26th
      expect(await h.app.allowance(h.ws, m("giver"))).toEqual({ day: "2026-11-26", limit: 5, used: 0, remaining: 5 });
      const r = await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :taco:", [mention("ana")], 5)));
      expect(r.ok && r.value.remainingAllowance).toBe(0);
    });

    test("S29: every successful gift emits a confirmation event with the remaining allowance", async () => {
      const h = await backend();
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :taco::taco:", [mention("ana")], 2)));
      expect(await h.events()).toEqual([{ type: "gift.given", giftId: "gift-1", giver: "giver", receivers: ["ana"], perReceiver: 2, totalCost: 2, remainingAllowance: 3, source: "message" }]);
    });
  });

  describe.skipIf(skip)("reactions, edits and deletions", () => {
    test("S18, S19: a reaction gives to the author and consumes the reactor's allowance", async () => {
      const h = await backend();
      const r = await h.app.execute(reactCmd(h.ws, "giver", "T:C1:r1", { author: "lind" }));
      expect(r).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", receivers: ["lind"], perReceiver: 1, totalCost: 1, remainingAllowance: 4 } });
      expect((await h.entries()).map((e) => [e.kind, e.memberId, e.source])).toEqual([["gift", "lind", "reaction"]]);
      expect(await h.app.allowance(h.ws, m("giver"))).toMatchObject({ used: 1, remaining: 4 });
    });

    test("S20: reacting twice counts once; removing and re-adding the same day gives again (G8)", async () => {
      const h = await backend();
      await h.app.execute(reactCmd(h.ws, "giver", "T:C1:r1", { author: "lind" }));
      expect((await h.app.execute(reactCmd(h.ws, "giver", "T:C1:r1", { author: "lind" }))).replayed).toBe(true);
      expect(await h.entries()).toHaveLength(1);
      await h.app.execute(unreactCmd(h.ws, "giver", "T:C1:r1"));
      expect(await h.app.execute(reactCmd(h.ws, "giver", "T:C1:r1", { author: "lind" }))).toMatchObject({ ok: true, replayed: false });
      expect((await h.entries()).map((e) => e.kind)).toEqual(["gift", "gift_reversal", "gift"]);
      expect(await h.app.balances(h.ws, m("lind"))).toMatchObject({ received: 1 });
      expect((await h.commandLog()).map((r) => r.key)).toEqual([
        "slack:react:T:C1:r1:giver::taco::0",
        "slack:unreact:T:C1:r1:giver::taco::0",
        "slack:react:T:C1:r1:giver::taco::1",
      ]);
    });

    test("S21: removing a reaction the same day reverses it and returns the allowance; the next day it changes nothing", async () => {
      const h = await backend();
      await h.app.execute(reactCmd(h.ws, "giver", "T:C1:r1", { author: "lind" }));
      expect(await h.app.execute(unreactCmd(h.ws, "giver", "T:C1:r1"))).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", reversed: 1, allowanceRestored: 1 } });
      expect(await h.app.allowance(h.ws, m("giver"))).toMatchObject({ used: 0, remaining: 5 });
      expect(await h.app.balances(h.ws, m("lind"))).toEqual({ received: 0, given: 0, redeemable: 0 });
      await h.app.execute(reactCmd(h.ws, "bob", "T:C1:r9", { author: "lind" }));
      h.setNow(NEXT_DAY);
      expect(await h.app.execute(unreactCmd(h.ws, "bob", "T:C1:r9"))).toEqual({ ok: true, replayed: false, value: { giftId: "gift-2", reversed: 0, allowanceRestored: 0 } });
      expect(await h.app.balances(h.ws, m("lind"))).toMatchObject({ received: 1 });
    });

    test("S22: nobody can react-gift their own message", async () => {
      const h = await backend();
      expect(await h.app.execute(reactCmd(h.ws, "lind", "T:C1:r1", { author: "lind" }))).toEqual({ ok: false, replayed: false, error: { code: "not_a_gift" } });
      expect(await h.entries()).toEqual([]);
    });

    test("S23: an edit that newly qualifies becomes a gift at edit time", async () => {
      const h = await backend();
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana thanks", [mention("ana")], 0), "T:C1:e1"));
      const r = await h.app.execute(editCmd(h.ws, "T:C1:e1", "2", "@Ana thanks :taco:", [mention("ana")], 1));
      const [created] = await h.gifts();
      expect(created).toMatchObject({ messageRef: "T:C1:e1", text: "@Ana thanks :taco:" });
      expect(r).toEqual({ ok: true, replayed: false, value: { giftId: created?.id, added: 1, reversed: 0, remainingAllowance: 4 } });
      expect((await h.entries()).map((e) => [e.kind, e.memberId, e.amount, e.commandKey])).toEqual([["gift", "ana", 1, "slack:edit:T:C1:e1:2"]]);
    });

    test("S23: editing a gift recomputes it, applying the difference as reversal or top-up", async () => {
      const h = await backend();
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana @Diana :taco::taco:", [mention("ana"), mention("diana")], 2), "T:C1:e2"));
      const r = await h.app.execute(editCmd(h.ws, "T:C1:e2", "2", "@Ana :taco::taco::taco:", [mention("ana")], 3));
      expect(r).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", added: 1, reversed: 2, remainingAllowance: 2 } });
      expect(await h.app.balances(h.ws, m("ana"))).toMatchObject({ received: 3 });
      expect(await h.app.balances(h.ws, m("diana"))).toMatchObject({ received: 0 });
      expect(await h.app.allowance(h.ws, m("giver"))).toMatchObject({ used: 3 });
      expect((await h.gifts())[0]?.text).toBe("@Ana :taco::taco::taco:");
      expect(await h.gifts()).toHaveLength(1);
    });

    test("S24: deleting a gift message the same day reverses it; the next day it stands", async () => {
      const h = await backend();
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :taco::taco:", [mention("ana")], 2), "T:C1:d1"));
      expect(await h.app.execute(delCmd(h.ws, "T:C1:d1"))).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", reversed: 2, allowanceRestored: 2 } });
      expect(await h.app.allowance(h.ws, m("giver"))).toMatchObject({ used: 0 });
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :taco:", [mention("ana")], 1), "T:C1:d2"));
      h.setNow(NEXT_DAY);
      expect(await h.app.execute(delCmd(h.ws, "T:C1:d2"))).toEqual({ ok: true, replayed: false, value: { giftId: "gift-2", reversed: 0, allowanceRestored: 0 } });
      expect(await h.app.balances(h.ws, m("ana"))).toMatchObject({ received: 1 });
    });
  });

  describe.skipIf(skip)("adjustments", () => {
    test("S36: a bonus to many members raises redeemable only; members may not grant", async () => {
      const h = await backend();
      expect(await h.app.execute(bonus(h.ws, "api:t:1", ["ana", "bob"], 5))).toEqual({ ok: true, replayed: false, value: { memberIds: ["ana", "bob"], amount: 5 } });
      expect(await h.app.balances(h.ws, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 5 });
      expect((await h.entries()).map((e) => [e.kind, e.memberId, e.amount, e.cause])).toEqual([["bonus", "ana", 5, { type: "admin" }], ["bonus", "bob", 5, { type: "admin" }]]);
      expect((await h.events()).map((e) => e.type)).toEqual(["adjustment.made"]);
      expect(await h.app.execute({ ...bonus(h.ws, "api:t:2", ["ana"], 5), actor: memberActor("ana") })).toEqual({ ok: false, replayed: false, error: { code: "forbidden", need: "admin" } });
      expect(await h.entries()).toHaveLength(2);
    });

    test("S37, S35: a deduction needs a reason and may drive redeemable negative", async () => {
      const h = await backend();
      await h.app.execute(bonus(h.ws, "api:t:1", ["ana"], 5));
      expect(await h.app.execute(deduct(h.ws, "api:t:2", "ana", 7))).toEqual({ ok: true, replayed: false, value: { memberId: "ana", amount: 7 } });
      expect(await h.app.balances(h.ws, m("ana"))).toEqual({ received: 0, given: 0, redeemable: -2 });
      expect(await h.app.execute(deduct(h.ws, "api:t:3", "ana", 2, ""))).toEqual({ ok: false, replayed: false, error: { code: "reason_required" } });
      expect(await h.entries()).toHaveLength(2);
    });

    test("S38: reversing a gift undoes received and given and does not restore the giver's allowance", async () => {
      const h = await backend();
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana @Bob :taco::taco:", [mention("ana"), mention("bob")], 2)));
      expect(await h.app.execute(reverse(h.ws, "api:t:9", "gift-1"))).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", reversed: 4 } });
      expect(await h.app.balances(h.ws, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 0 });
      expect(await h.app.balances(h.ws, m("giver"))).toEqual({ received: 0, given: 0, redeemable: 0 });
      expect(await h.app.allowance(h.ws, m("giver"))).toMatchObject({ used: 4, remaining: 1 });
      expect((await h.entries()).filter((e) => e.kind === "gift_reversal").map((e) => [e.memberId, e.amount, e.allowanceDay])).toEqual([["ana", 2, null], ["bob", 2, null]]);
    });

    test("S38, S23: an admin-reversed gift stays reversed when the author later edits the message", async () => {
      const h = await backend();
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana abuse :taco::taco::taco:", [mention("ana")], 3), "T:C1:p8"));
      expect(await h.app.execute(reverse(h.ws, "api:t:p8", "gift-1"))).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", reversed: 3 } });
      expect((await h.gifts())[0]?.closedBy).toBe("admin");
      // Same day: a smaller edit that would fit the allowance is refused.
      expect(await h.app.execute(editCmd(h.ws, "T:C1:p8", "1", "@Ana abuse :taco:", [mention("ana")], 1))).toEqual({ ok: false, replayed: false, error: { code: "gift_closed" } });
      // Next day: a text tweak with the same amount is refused.
      h.setNow(NEXT_DAY);
      expect(await h.app.execute(editCmd(h.ws, "T:C1:p8", "2", "@Ana abuse (typo fixed) :taco::taco::taco:", [mention("ana")], 3))).toEqual({ ok: false, replayed: false, error: { code: "gift_closed" } });
      expect(await h.app.balances(h.ws, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 0 });
      expect((await h.entries()).map((e) => [e.kind, e.memberId, e.amount])).toEqual([["gift", "ana", 3], ["gift_reversal", "ana", 3]]);
      expect((await h.events()).filter((e) => e.type === "gift.given")).toHaveLength(1);
      expect((await h.gifts()).map((g) => [g.closedBy, g.text])).toEqual([["admin", "@Ana abuse :taco::taco::taco:"]]);
    });

    test("S24, S23: a deleted gift message stays reversed when a late edit arrives", async () => {
      const h = await backend();
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :taco::taco:", [mention("ana")], 2), "T:C1:p4"));
      await h.app.execute(delCmd(h.ws, "T:C1:p4"));
      expect((await h.gifts())[0]?.closedBy).toBe("message_deleted");
      expect(await h.app.execute(editCmd(h.ws, "T:C1:p4", "2", "@Ana :taco::taco:", [mention("ana")], 2))).toEqual({ ok: false, replayed: false, error: { code: "gift_closed" } });
      expect(await h.app.balances(h.ws, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 0 });
      expect(await h.app.allowance(h.ws, m("giver"))).toMatchObject({ used: 0 });
      expect((await h.entries()).map((e) => e.kind)).toEqual(["gift", "gift_reversal"]);
    });

    test("S38, S20: a reaction gift an admin reversed is not given again when the giver re-adds the reaction", async () => {
      const h = await backend();
      await h.app.execute(reactCmd(h.ws, "giver", "T:C1:r8", { author: "lind" }));
      await h.app.execute(reverse(h.ws, "api:t:r8", "gift-1"));
      await h.app.execute(unreactCmd(h.ws, "giver", "T:C1:r8"));
      h.setNow(NEXT_DAY);
      const again = await h.app.execute({ ...reactCmd(h.ws, "giver", "T:C1:r8", { author: "lind" }), key: key("slack:react:T:C1:r8:giver::taco:#2") });
      expect(again).toEqual({ ok: false, replayed: false, error: { code: "gift_closed" } });
      expect(await h.app.balances(h.ws, m("lind"))).toEqual({ received: 0, given: 0, redeemable: 0 });
      expect((await h.entries()).map((e) => e.kind)).toEqual(["gift", "gift_reversal"]);
    });

    test("S39: a bulk reset zeroes everyone's redeemable with one deduction each and keeps received", async () => {
      const h = await backend();
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :taco::taco::taco:", [mention("ana")], 3)));
      await h.app.execute(bonus(h.ws, "api:t:1", ["bob"], 4));
      expect(await h.app.execute(reset(h.ws, "api:t:2"))).toEqual({ ok: true, replayed: false, value: { members: 2, total: 7 } });
      expect(await h.app.balances(h.ws, m("ana"))).toEqual({ received: 3, given: 0, redeemable: 0 });
      expect(await h.app.balances(h.ws, m("bob"))).toEqual({ received: 0, given: 0, redeemable: 0 });
      expect((await h.entries()).filter((e) => e.kind === "deduction").map((e) => [e.memberId, e.amount])).toEqual([["ana", 3], ["bob", 4]]);
    });

    test("S40: every admin adjustment appears in the audit log with actor, time and reason", async () => {
      const h = await backend();
      await h.app.execute(bonus(h.ws, "api:t:1", ["ana"], 5, "launch"));
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :taco:", [mention("ana")], 1)));
      await h.app.execute(deduct(h.ws, "api:t:2", "ana", 1, "typo"));
      expect(await h.app.auditLog(h.ws)).toEqual([
        { key: "api:t:1", action: "bonus", actor: admin, at: T0, reason: "launch", ok: true },
        { key: "api:t:2", action: "deduction", actor: admin, at: T0, reason: "typo", ok: true },
      ]);
    });

    test("S30: reversals add rows; committed entries never change", async () => {
      const h = await backend();
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana :taco:", [mention("ana")], 1)));
      const [before] = await h.entries();
      await h.app.execute(reverse(h.ws, "api:t:1", "gift-1"));
      const after = await h.entries();
      expect(after).toHaveLength(2);
      expect(after[0]).toEqual(before);
      expect(after.map((e) => [e.kind, e.commandKey, e.ordinal])).toEqual([
        ["gift", before?.commandKey, 0],
        ["gift_reversal", "api:t:1", 0],
      ]);
      expect(after[1]!.seq).toBeGreaterThan(after[0]!.seq);
    });

    test("S34: the SQL-sum balances equal a full ledger replay", async () => {
      const h = await backend();
      await h.app.execute(giveCmd(h.ws, "giver", msg("@Ana @Bob :taco::taco:", [mention("ana"), mention("bob")], 2)));
      await h.app.execute(bonus(h.ws, "api:t:1", ["ana"], 3));
      await h.app.execute(deduct(h.ws, "api:t:2", "bob", 1));
      await h.app.execute(reverse(h.ws, "api:t:3", "gift-1"));
      expect(await h.app.ledgerCheck(h.ws)).toEqual({ ok: true, members: 3, mismatches: [] });
    });

    test("S17: an API write retried with the same key returns the original result and writes once", async () => {
      const h = await backend();
      const first = await h.app.execute(bonus(h.ws, "api:t:1", ["ana"], 5));
      expect(await h.app.execute(bonus(h.ws, "api:t:1", ["ana"], 5))).toEqual({ ...first, replayed: true });
      expect(await h.entries()).toHaveLength(1);
      const clash = await h.app.execute(bonus(h.ws, "api:t:1", ["ana"], 6));
      expect(clash.ok === false && clash.error.code).toBe("idempotency_key_reused");
    });
  });
});
