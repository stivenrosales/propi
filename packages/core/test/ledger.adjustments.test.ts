import { describe, expect, test } from "vitest";
import {
  auditRecord,
  decideDeduct,
  decideGrantBonus,
  decideResetAll,
  decideReverseGift,
  type Actor,
  type CommandKey,
  type Deduct,
  type Gift,
  type GrantBonus,
  type MemberId,
  type PosInt,
} from "../src/index.ts";
import { NOON_LIMA, WS, gid, key, m, memberActor, record } from "./fixtures.ts";

const admin = memberActor("boss", "admin");
const known = new Set([m("ana"), m("bob")]);
const bonus = (over: Partial<GrantBonus> = {}): GrantBonus => ({
  type: "GrantBonus",
  key: key("api:t:1"),
  workspaceId: WS,
  actor: admin,
  at: NOON_LIMA,
  memberIds: [m("ana"), m("bob")],
  amount: 5 as PosInt,
  reason: "Q4 launch",
  ...over,
});
const deduct = (over: Partial<Deduct> = {}): Deduct => ({
  type: "Deduct",
  key: key("api:t:2"),
  workspaceId: WS,
  actor: admin,
  at: NOON_LIMA,
  memberId: m("ana"),
  amount: 3 as PosInt,
  reason: "duplicate payout",
  ...over,
});

describe("admin adjustments", () => {
  test("S36: an admin grants N > 0 to many members, added to redeemable only", () => {
    const d = decideGrantBonus({ knownMembers: known }, bonus(), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: true, value: { memberIds: ["ana", "bob"], amount: 5 } });
    expect(d.entries).toEqual([
      { kind: "bonus", amount: 5, memberId: "ana", counterpartId: null, cause: { type: "admin" }, source: null, allowanceDay: null, reason: "Q4 launch" },
      { kind: "bonus", amount: 5, memberId: "bob", counterpartId: null, cause: { type: "admin" }, source: null, allowanceDay: null, reason: "Q4 launch" },
    ]);
    expect(d.events).toEqual([{ type: "adjustment.made", kind: "bonus", memberIds: ["ana", "bob"], amount: 5, reason: "Q4 launch" }]);
    expect(decideGrantBonus({ knownMembers: known }, bonus({ actor: memberActor("ana") }), NOON_LIMA).outcome).toEqual({
      ok: false,
      error: { code: "forbidden", need: "admin" },
    });
    expect(decideGrantBonus({ knownMembers: known }, bonus({ amount: 0 as PosInt }), NOON_LIMA).outcome).toEqual({
      ok: false,
      error: { code: "invalid_amount" },
    });
    expect(decideGrantBonus({ knownMembers: known }, bonus({ memberIds: [m("ghost")] }), NOON_LIMA).outcome).toEqual({
      ok: false,
      error: { code: "unknown_member", memberId: "ghost" },
    });
  });

  test("S37: a deduction removes N > 0 from redeemable and needs a reason", () => {
    const d = decideDeduct({ knownMembers: known }, deduct(), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: true, value: { memberId: "ana", amount: 3 } });
    expect(d.entries).toEqual([
      { kind: "deduction", amount: 3, memberId: "ana", counterpartId: null, cause: { type: "admin" }, source: null, allowanceDay: null, reason: "duplicate payout" },
    ]);
    expect(decideDeduct({ knownMembers: known }, deduct({ reason: "  " }), NOON_LIMA)).toEqual({
      outcome: { ok: false, error: { code: "reason_required" } },
      entries: [],
      writes: [],
      events: [],
    });
  });

  test("S35: a deduction is not guarded, so it may drive redeemable negative", () => {
    // The decider never reads the balance: an admin deduction of 3 on a member with 0 is accepted.
    const d = decideDeduct({ knownMembers: known }, deduct(), NOON_LIMA);
    expect(d.outcome.ok).toBe(true);
  });

  test("S38: an admin gift reversal undoes received/given without restoring the giver's allowance", () => {
    const gift: Gift = { id: gid("g1"), giver: m("bob"), messageRef: "T:C1:1", source: "message", emoji: null, channelId: "C1", isPrivate: false, text: "x", valueIds: [], allowanceDay: null, createdAt: NOON_LIMA, closedBy: null };
    const net = new Map<MemberId, number>([[m("ana"), 2], [m("cy"), 0]]);
    const d = decideReverseGift({ gift, net }, { type: "ReverseGift", key: key("api:t:3"), workspaceId: WS, actor: admin, at: NOON_LIMA, giftId: gid("g1"), reason: "abuse" }, NOON_LIMA);
    expect(d.outcome).toEqual({ ok: true, value: { giftId: "g1", reversed: 2 } });
    expect(d.entries).toEqual([
      { kind: "gift_reversal", amount: 2, memberId: "ana", counterpartId: "bob", cause: { type: "gift", giftId: "g1" }, source: "message", allowanceDay: null, reason: "abuse" },
    ]);
    expect(d.events).toEqual([
      { type: "gift.reversed", giftId: "g1", amount: 2, why: "admin" },
      { type: "adjustment.made", kind: "reversal", memberIds: ["ana"], amount: 2, reason: "abuse" },
    ]);
    // The reversal is final: the gift header is closed so a later edit cannot re-gift it (S23).
    expect(d.writes).toEqual([{ t: "gift.upsert", gift: { ...gift, closedBy: "admin" } }]);
    expect(decideReverseGift({ gift: null, net: new Map() }, { type: "ReverseGift", key: key("api:t:4"), workspaceId: WS, actor: admin, at: NOON_LIMA, giftId: gid("nope"), reason: "x" }, NOON_LIMA).outcome).toEqual({
      ok: false,
      error: { code: "gift_not_found" },
    });
  });

  test("S39: a bulk reset writes one deduction per member with positive redeemable and leaves received alone", () => {
    const redeemable = new Map<MemberId, number>([[m("ana"), 7], [m("bob"), 0], [m("cy"), -2]]);
    const d = decideResetAll({ redeemable }, { type: "ResetAllRedeemable", key: key("api:t:5"), workspaceId: WS, actor: admin, at: NOON_LIMA, reason: "new year" }, NOON_LIMA);
    expect(d.outcome).toEqual({ ok: true, value: { members: 1, total: 7 } });
    expect(d.entries).toEqual([
      { kind: "deduction", amount: 7, memberId: "ana", counterpartId: null, cause: { type: "admin" }, source: null, allowanceDay: null, reason: "new year" },
    ]);
    expect(d.entries.every((e) => e.kind === "deduction")).toBe(true);
  });

  test("S40: an admin adjustment becomes an audit record with actor, time and reason", () => {
    const actor: Actor = admin;
    expect(
      auditRecord({ key: "api:t:2" as CommandKey, commandType: "Deduct", actor, at: NOON_LIMA, command: deduct(), result: { ok: true, value: {} } }),
    ).toEqual({ key: "api:t:2", action: "deduction", actor, at: NOON_LIMA, reason: "duplicate payout", ok: true });
    expect(auditRecord({ key: "k" as CommandKey, commandType: "GiveByMessage", actor, at: NOON_LIMA, command: {}, result: { ok: true, value: {} } })).toBeNull();
    expect(record("x").role).toBe("member");
  });
});
