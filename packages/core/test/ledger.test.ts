import { describe, expect, test } from "vitest";
import {
  EFFECTS,
  allowanceUsed,
  netPerReceiver,
  orderLocks,
  replay,
  signedAmount,
  type CommandKey,
  type LedgerEntry,
  type LocalDate,
  type NewEntry,
  type PosInt,
} from "../src/index.ts";
import { NOON_LIMA, WS, gid, m } from "./fixtures.ts";

const D = "2026-11-25" as LocalDate;
let seq = 0;
const row = (e: Partial<NewEntry> & Pick<NewEntry, "kind" | "amount" | "memberId">): LedgerEntry => ({
  counterpartId: null,
  cause: { type: "admin" },
  source: null,
  allowanceDay: null,
  reason: null,
  ...e,
  seq: ++seq,
  workspaceId: WS,
  commandKey: `k${seq}` as CommandKey,
  ordinal: 0,
  at: NOON_LIMA,
});
const n = (x: number) => x as PosInt;
const giftRow = (to: string, from: string, amount: number, giftId = "g1", day: LocalDate | null = D) =>
  row({ kind: "gift", amount: n(amount), memberId: m(to), counterpartId: m(from), cause: { type: "gift", giftId: gid(giftId) }, source: "message", allowanceDay: day });

describe("ledger", () => {
  test("S30: entries carry type, magnitude, member, counterpart, cause, time and reason; the sign comes from the kind", () => {
    expect(EFFECTS).toEqual({
      gift: { sign: 1, received: true, given: true, redeemable: true },
      gift_reversal: { sign: -1, received: true, given: true, redeemable: true },
      bonus: { sign: 1, received: false, given: false, redeemable: true },
      rule_award: { sign: 1, received: false, given: false, redeemable: true },
      quest_reward: { sign: 1, received: false, given: false, redeemable: true },
      spend: { sign: -1, received: false, given: false, redeemable: true },
      refund: { sign: 1, received: false, given: false, redeemable: true },
      deduction: { sign: -1, received: false, given: false, redeemable: true },
    });
    const e = giftRow("ana", "bob", 3);
    expect(signedAmount(e)).toBe(3);
    expect(signedAmount(row({ kind: "deduction", amount: n(2), memberId: m("ana") }))).toBe(-2);
    expect(Object.keys(e).sort()).toEqual(
      ["allowanceDay", "amount", "at", "cause", "commandKey", "counterpartId", "kind", "memberId", "ordinal", "reason", "seq", "source", "workspaceId"].sort(),
    );
  });

  test("S31: received sums peer gifts minus their reversals; bonuses, rule awards and quest rewards do not count", () => {
    const b = replay([
      giftRow("ana", "bob", 3),
      row({ kind: "gift_reversal", amount: n(1), memberId: m("ana"), counterpartId: m("bob"), cause: { type: "gift", giftId: gid("g1") } }),
      row({ kind: "bonus", amount: n(10), memberId: m("ana") }),
      row({ kind: "rule_award", amount: n(5), memberId: m("ana"), cause: { type: "rule", ruleId: "r", period: "2026-11" } }),
      row({ kind: "quest_reward", amount: n(5), memberId: m("ana"), cause: { type: "quest", submissionId: "s" } }),
    ]);
    expect(b.get(m("ana"))?.received).toBe(2);
  });

  test("S32: redeemable = received + bonuses + awards + rewards + refunds - spends - deductions", () => {
    const b = replay([
      giftRow("ana", "bob", 10),
      row({ kind: "bonus", amount: n(4), memberId: m("ana") }),
      row({ kind: "rule_award", amount: n(3), memberId: m("ana"), cause: { type: "rule", ruleId: "r", period: "2026-11" } }),
      row({ kind: "quest_reward", amount: n(2), memberId: m("ana"), cause: { type: "quest", submissionId: "s" } }),
      row({ kind: "spend", amount: n(12), memberId: m("ana"), cause: { type: "redemption", redemptionId: "x" } }),
      row({ kind: "refund", amount: n(12), memberId: m("ana"), cause: { type: "redemption", redemptionId: "x" } }),
      row({ kind: "spend", amount: n(6), memberId: m("ana"), cause: { type: "redemption", redemptionId: "y" } }),
      row({ kind: "deduction", amount: n(1), memberId: m("ana") }),
    ]);
    expect(b.get(m("ana"))).toEqual({ received: 10, given: 0, redeemable: 10 + 4 + 3 + 2 + 12 - 12 - 6 - 1 });
  });

  test("S33: given sums units the member gave, net of reversals", () => {
    const b = replay([
      giftRow("ana", "bob", 2),
      giftRow("cy", "bob", 2),
      row({ kind: "gift_reversal", amount: n(2), memberId: m("cy"), counterpartId: m("bob"), cause: { type: "gift", giftId: gid("g1") } }),
    ]);
    expect(b.get(m("bob"))).toEqual({ received: 0, given: 2, redeemable: 0 });
  });

  test("S34: replay is deterministic and order-independent, so balances can always be rebuilt from the ledger", () => {
    const entries = [giftRow("ana", "bob", 2), row({ kind: "bonus", amount: n(3), memberId: m("bob") }), giftRow("bob", "ana", 1, "g2")];
    expect(replay(entries)).toEqual(replay([...entries].reverse()));
    expect(replay(entries)).toEqual(
      new Map([
        [m("ana"), { received: 2, given: 1, redeemable: 2 }],
        [m("bob"), { received: 1, given: 2, redeemable: 4 }],
      ]),
    );
  });

  test("S19: allowance used today is the giver's gifts on that day net of same-day reversals", () => {
    const entries = [
      giftRow("ana", "bob", 3),
      giftRow("cy", "bob", 1, "g2", "2026-11-24" as LocalDate),
      giftRow("cy", "bob", 1, "g3", null),
      row({ kind: "gift_reversal", amount: n(2), memberId: m("ana"), counterpartId: m("bob"), cause: { type: "gift", giftId: gid("g1") }, allowanceDay: D }),
      row({ kind: "gift_reversal", amount: n(1), memberId: m("ana"), counterpartId: m("bob"), cause: { type: "gift", giftId: gid("g1") }, allowanceDay: null }),
    ];
    expect(allowanceUsed(entries, m("bob"), D)).toBe(1);
    expect(netPerReceiver(entries, gid("g1"))).toEqual(new Map([[m("ana"), 0]]));
  });

  test("locks are ordered aggregate -> budget -> member ascending and deduplicated (G4)", () => {
    expect(orderLocks(["member:b", "member:a", "budget:ws:2026-11", "gift:T:C:1", "member:a"])).toEqual([
      "gift:T:C:1",
      "budget:ws:2026-11",
      "member:a",
      "member:b",
    ]);
  });
});
