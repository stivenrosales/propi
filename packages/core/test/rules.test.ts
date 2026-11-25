import { describe, expect, test } from "vitest";
import type { GiftId, Instant, LedgerEntry, PosInt, ValueId } from "../src/index.ts";
// Engagement modules are exported from their folders until the integrator adds them to src/index.ts.
import {
  decideDefineAwardRule,
  decideEvaluateRule,
  evaluateRuleCommand,
  lastClosedRulePeriod,
  rulePeriodOf,
  rulePeriodRange,
  ruleKey,
  rulesDue,
  type AwardRule,
  type EvaluateRule,
  type EvaluateRuleSnapshot,
} from "../src/rules/index.ts";
import { WS, at, key, m, memberActor, settings } from "./fixtures.ts";

const TZ = "America/Lima";
const NOV = rulePeriodRange("month", "2026-11", TZ)!;
const DEC_2 = at("2026-12-02T15:00:00Z");
const p = (n: number) => n as PosInt;

let seq = 0;
const gift = (giver: string, receiver: string, amount: number, when: Instant, giftId = `g${++seq}`): LedgerEntry => ({
  seq: ++seq,
  workspaceId: WS,
  commandKey: key(`k${seq}`),
  ordinal: 0,
  at: when,
  kind: "gift",
  amount: p(amount),
  memberId: m(receiver),
  counterpartId: m(giver),
  cause: { type: "gift", giftId: giftId as GiftId },
  source: "message",
  allowanceDay: null,
  reason: null,
});
const reversal = (g: LedgerEntry, when: Instant): LedgerEntry => ({ ...g, seq: ++seq, at: when, kind: "gift_reversal" });

const rule = (over: Partial<AwardRule> = {}): AwardRule => ({
  id: "r1",
  name: "Top receiver",
  period: "month",
  criterion: { kind: "top_receivers", n: p(1) },
  reward: p(20),
  ties: "all_win",
  active: true,
  announceChannel: "C-wins",
  ...over,
});

const inNov = (day: number) => at(`2026-11-${String(day).padStart(2, "0")}T15:00:00Z`);
const everyone = new Set(["ana", "bob", "cy", "dee"].map(m));

const snap = (over: Partial<EvaluateRuleSnapshot> = {}): EvaluateRuleSnapshot => ({
  settings: settings(),
  rule: rule(),
  entries: [],
  giftValues: new Map(),
  eligible: everyone,
  alreadyAwarded: false,
  ...over,
});
const cmd = (over: Partial<EvaluateRule> = {}): EvaluateRule => ({
  type: "EvaluateRule",
  key: ruleKey("r1", "2026-11"),
  workspaceId: WS,
  actor: { kind: "system", job: "rules" },
  at: NOV.end,
  ruleId: "r1",
  period: "2026-11",
  ...over,
});
const winners = (d: ReturnType<typeof decideEvaluateRule>) => (d.outcome.ok ? d.outcome.value.winners : d.outcome.error);

describe("award rules", () => {
  test("S60: an admin defines a rule with a period, a criterion, a reward and tie handling (all tied win by default)", () => {
    const def = {
      type: "DefineAwardRule" as const,
      key: key("api:t:rule1"),
      workspaceId: WS,
      actor: memberActor("boss", "admin"),
      at: NOV.start,
      rule: { id: "r1", name: "Kind hearts", period: "quarter" as const, criterion: { kind: "distinct_receivers" as const, k: p(3) }, reward: p(10), announceChannel: null },
    };
    const d = decideDefineAwardRule({ values: [] }, def, NOV.start);
    expect(d.outcome).toEqual({ ok: true, value: { ruleId: "r1" } });
    expect(d.writes).toEqual([{ t: "rule.upsert", rule: { ...def.rule, ties: "all_win", active: true } }]);
    expect(decideDefineAwardRule({ values: [] }, { ...def, actor: memberActor("ana") }, NOV.start).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    const badValue = { ...def, rule: { ...def.rule, criterion: { kind: "most_tagged" as const, valueId: "v-x" as ValueId } } };
    expect(decideDefineAwardRule({ values: [] }, badValue, NOV.start).outcome).toEqual({ ok: false, error: { code: "not_found", what: "value" } });
    expect(decideDefineAwardRule({ values: [] }, { ...def, rule: { ...def.rule, reward: 0 as PosInt } }, NOV.start).outcome).toEqual({
      ok: false,
      error: { code: "invalid_field", field: "reward" },
    });
  });

  test("S60: top N receivers, net of reversals, only active members win", () => {
    const g = gift("bob", "cy", 9, inNov(3));
    const entries = [gift("bob", "ana", 5, inNov(2)), g, reversal(g, inNov(4)), gift("ana", "dee", 3, inNov(5)), gift("ana", "gone", 50, inNov(5))];
    const d = decideEvaluateRule(snap({ entries, rule: rule({ criterion: { kind: "top_receivers", n: p(2) } }) }), cmd(), DEC_2);
    expect(winners(d)).toEqual(["ana", "dee"]);
  });

  test("S60: top N givers", () => {
    const entries = [gift("bob", "ana", 5, inNov(2)), gift("cy", "ana", 2, inNov(2)), gift("bob", "dee", 1, inNov(9))];
    const d = decideEvaluateRule(snap({ entries, rule: rule({ criterion: { kind: "top_givers", n: p(1) } }) }), cmd(), DEC_2);
    expect(winners(d)).toEqual(["bob"]);
  });

  test("S60: gave to at least K distinct people", () => {
    const entries = [gift("bob", "ana", 1, inNov(2)), gift("bob", "cy", 1, inNov(3)), gift("bob", "dee", 1, inNov(4)), gift("ana", "cy", 1, inNov(2)), gift("ana", "cy", 1, inNov(3))];
    const d = decideEvaluateRule(snap({ entries, rule: rule({ criterion: { kind: "distinct_receivers", k: p(3) } }) }), cmd(), DEC_2);
    expect(winners(d)).toEqual(["bob"]);
  });

  test("S60: a streak of P consecutive periods with at least one gift given", () => {
    const entries = [
      gift("ana", "bob", 1, at("2026-09-10T15:00:00Z")),
      gift("ana", "bob", 1, at("2026-10-10T15:00:00Z")),
      gift("ana", "bob", 1, inNov(10)),
      gift("cy", "bob", 1, at("2026-09-10T15:00:00Z")),
      gift("cy", "bob", 1, inNov(10)), // cy skipped October
    ];
    const d = decideEvaluateRule(snap({ entries, rule: rule({ criterion: { kind: "giving_streak", periods: p(3) } }) }), cmd(), DEC_2);
    expect(winners(d)).toEqual(["ana"]);
  });

  test("S60: most tagged with value V counts units received through gifts tagged V", () => {
    const own = "v-own" as ValueId;
    const entries = [gift("bob", "ana", 2, inNov(2), "ga"), gift("bob", "cy", 5, inNov(2), "gc"), gift("dee", "ana", 2, inNov(3), "gd")];
    const giftValues = new Map<GiftId, readonly ValueId[]>([["ga" as GiftId, [own]], ["gd" as GiftId, [own]], ["gc" as GiftId, []]]);
    const d = decideEvaluateRule(snap({ entries, giftValues, rule: rule({ criterion: { kind: "most_tagged", valueId: own } }) }), cmd(), DEC_2);
    expect(winners(d)).toEqual(["ana"]);
  });

  test("S60: ties: all tied members win by default; 'skip_tied' drops a tie that crosses the cut", () => {
    const entries = [gift("bob", "ana", 3, inNov(2)), gift("bob", "cy", 3, inNov(2)), gift("bob", "dee", 1, inNov(2))];
    expect(winners(decideEvaluateRule(snap({ entries }), cmd(), DEC_2))).toEqual(["ana", "cy"]);
    expect(winners(decideEvaluateRule(snap({ entries, rule: rule({ ties: "skip_tied" }) }), cmd(), DEC_2))).toEqual([]);
    expect(winners(decideEvaluateRule(snap({ entries, rule: rule({ ties: "skip_tied", criterion: { kind: "top_receivers", n: p(2) } }) }), cmd(), DEC_2))).toEqual(["ana", "cy"]);
  });

  test("S61: a rule is evaluated only after its period closes in the workspace timezone", () => {
    // 2026-12-01 04:59Z is still November 30 in Lima (UTC-5).
    const early = decideEvaluateRule(snap(), cmd(), at("2026-12-01T04:59:00Z"));
    expect(early.outcome).toEqual({ ok: false, error: { code: "period_not_closed", closesAt: at("2026-12-01T05:00:00Z") } });
    expect(decideEvaluateRule(snap(), cmd(), at("2026-12-01T05:00:00Z")).outcome.ok).toBe(true);
    expect(rulePeriodOf("week", at("2026-11-30T04:00:00Z"), TZ)).toBe("2026-W48"); // still Sunday Nov 29 in Lima
  });

  test("S61: the result is announced in the configured channel and DM'd to the winners", () => {
    const entries = [gift("bob", "ana", 3, inNov(2))];
    const d = decideEvaluateRule(snap({ entries }), cmd(), DEC_2);
    expect(d.events).toEqual([{ type: "rule.awarded", ruleId: "r1", period: "2026-11", winners: ["ana"], amount: 20, announceChannel: "C-wins" }]);
  });

  test("S61: the scheduler evaluates each active rule for its last closed period, with deterministic keys", () => {
    const rules = [rule(), rule({ id: "r2", period: "week" }), rule({ id: "r3", active: false })];
    const now = at("2026-12-02T15:00:00Z");
    expect(lastClosedRulePeriod("week", now, TZ)).toBe("2026-W48");
    const due = rulesDue(rules, now, TZ, WS);
    expect(due.map((c) => [c.key, c.at])).toEqual([
      ["rule:r1:2026-11", NOV.end],
      ["rule:r2:2026-W48", rulePeriodRange("week", "2026-W48", TZ)!.end],
    ]);
    expect(evaluateRuleCommand(WS, "r1", "2026-11", NOV.end)).toEqual(due[0]);
  });

  test("S62: evaluating a rule twice for the same period never pays twice", () => {
    const entries = [gift("bob", "ana", 3, inNov(2))];
    const d = decideEvaluateRule(snap({ entries, alreadyAwarded: true }), cmd(), DEC_2);
    expect(d.outcome).toEqual({ ok: false, error: { code: "already_evaluated" } });
    expect(d.entries).toEqual([]);
    expect(ruleKey("r1", "2026-11")).toBe("rule:r1:2026-11");
  });

  test("S63: rule awards are rule_award entries: redeemable only, received unchanged", () => {
    const entries = [gift("bob", "ana", 3, inNov(2))];
    const d = decideEvaluateRule(snap({ entries }), cmd(), DEC_2);
    expect(d.entries).toEqual([
      { kind: "rule_award", amount: 20, memberId: "ana", counterpartId: null, cause: { type: "rule", ruleId: "r1", period: "2026-11" }, source: null, allowanceDay: null, reason: "Top receiver" },
    ]);
  });

  test("S60: inactive rules and unknown periods are refused", () => {
    expect(decideEvaluateRule(snap({ rule: rule({ active: false }) }), cmd(), DEC_2).outcome).toEqual({ ok: false, error: { code: "rule_inactive" } });
    expect(decideEvaluateRule(snap({ rule: null }), cmd(), DEC_2).outcome).toEqual({ ok: false, error: { code: "not_found", what: "rule" } });
    expect(decideEvaluateRule(snap(), cmd({ period: "2026-W48" }), DEC_2).outcome).toEqual({ ok: false, error: { code: "invalid_field", field: "period" } });
  });
});
