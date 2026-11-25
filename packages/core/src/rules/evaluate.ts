// S60-S63: rule evaluation as a pure decider over the period's ledger entries.
import type { LedgerEntry, NewEntry } from "../ledger/entries.ts";
import { signedAmount } from "../ledger/entries.ts";
import { replay } from "../ledger/replay.ts";
import type { CommandKey, Instant, MemberId, WorkspaceId } from "../shared/types.ts";
import { isPosInt } from "../shared/types.ts";
import type { Value } from "../values/values.ts";
import type { WorkspaceSettings } from "../workspace/settings.ts";
import { fail, isAdminOrSystem, ok, type ModuleDecision } from "./module-decision.ts";
import { lastClosedRulePeriod, rulePeriodRange, previousRulePeriod, type RulePeriodKind, type RulePeriodRange } from "./periods.ts";
import type { AwardRule, DefineAwardRule, EvaluateRule, RuleGiftValues, RuleAwardResult, RuleCriterion, RuleEvent, RuleWrite, TieHandling } from "./types.ts";

export type RuleDecision<T> = ModuleDecision<T, RuleEvent, RuleWrite>;

/** S62: one key per (rule, period). */
export const ruleKey = (ruleId: string, period: string): CommandKey => `rule:${ruleId}:${period}` as CommandKey;

/** A deterministic EvaluateRule: same rule and period -> same key and payload, so re-runs replay. */
export function evaluateRuleCommand(ws: WorkspaceId, ruleId: string, period: string, closesAt: Instant): EvaluateRule {
  return { type: "EvaluateRule", key: ruleKey(ruleId, period), workspaceId: ws, actor: { kind: "system", job: "rules" }, at: closesAt, ruleId, period };
}

/** S61: for each active rule, the evaluation of its last closed period. */
export function rulesDue(rules: readonly AwardRule[], now: Instant, tz: string, ws: WorkspaceId): EvaluateRule[] {
  const out: EvaluateRule[] = [];
  for (const r of rules) {
    if (!r.active) continue;
    const period = lastClosedRulePeriod(r.period, now, tz);
    const range = rulePeriodRange(r.period, period, tz);
    if (range !== null) out.push(evaluateRuleCommand(ws, r.id, period, range.end));
  }
  return out;
}

/** The time span whose entries a rule needs: the period, or P periods for a streak. */
export function ruleWindow(rule: AwardRule, period: string, tz: string): RulePeriodRange | null {
  const range = rulePeriodRange(rule.period, period, tz);
  if (range === null) return null;
  if (rule.criterion.kind !== "giving_streak") return range;
  let first = period;
  for (let i = 1; i < rule.criterion.periods; i++) first = previousRulePeriod(rule.period, first) ?? first;
  const firstRange = rulePeriodRange(rule.period, first, tz);
  return firstRange === null ? range : { start: firstRange.start, end: range.end };
}

export interface EvaluateRuleSnapshot {
  readonly settings: WorkspaceSettings;
  readonly rule: AwardRule | null;
  /** Ledger entries covering at least `ruleWindow`; others are ignored. */
  readonly entries: readonly LedgerEntry[];
  readonly giftValues: RuleGiftValues;
  /** Active members: only they can win (S7). */
  readonly eligible: ReadonlySet<MemberId>;
  /** A rule_award for this (rule, period) is already in the ledger (S62 defense in depth). */
  readonly alreadyAwarded: boolean;
}

const byId = (a: MemberId, b: MemberId) => (a < b ? -1 : a > b ? 1 : 0);
const within = (r: RulePeriodRange) => (e: LedgerEntry) => e.at >= r.start && e.at < r.end;
const isGiftKind = (e: NewEntry) => e.kind === "gift" || e.kind === "gift_reversal";

/** S60: top N by score with tie handling. Scores <= 0 never win. */
export function rankTopN(scores: ReadonlyMap<MemberId, number>, n: number, ties: TieHandling): MemberId[] {
  const ranked = [...scores].filter(([, s]) => s > 0).sort(([a, x], [b, y]) => y - x || byId(a, b));
  if (ranked.length <= n) return ranked.map(([id]) => id);
  const cutoff = ranked[n - 1]![1];
  const atOrAbove = ranked.filter(([, s]) => s >= cutoff);
  if (ties === "all_win" || atOrAbove.length <= n) return atOrAbove.map(([id]) => id);
  return ranked.filter(([, s]) => s > cutoff).map(([id]) => id);
}

/** Net units per (giver, receiver) over gift entries. */
function netPairs(entries: readonly LedgerEntry[]): Map<MemberId, Map<MemberId, number>> {
  const out = new Map<MemberId, Map<MemberId, number>>();
  for (const e of entries) {
    if (!isGiftKind(e) || e.counterpartId === null) continue;
    const row = out.get(e.counterpartId) ?? new Map<MemberId, number>();
    row.set(e.memberId, (row.get(e.memberId) ?? 0) + signedAmount(e));
    out.set(e.counterpartId, row);
  }
  return out;
}

function pick<T>(map: ReadonlyMap<MemberId, T>, eligible: ReadonlySet<MemberId>): Map<MemberId, T> {
  return new Map([...map].filter(([id]) => eligible.has(id)));
}

/** S60: who wins `rule` for `period`. */
export function ruleWinners(rule: AwardRule, period: string, s: Pick<EvaluateRuleSnapshot, "settings" | "entries" | "giftValues" | "eligible">): MemberId[] {
  const tz = s.settings.timezone;
  const range = rulePeriodRange(rule.period, period, tz);
  if (range === null) return [];
  const inPeriod = s.entries.filter(within(range));
  const c: RuleCriterion = rule.criterion;
  switch (c.kind) {
    case "top_receivers":
    case "top_givers": {
      const balances = replay(inPeriod);
      const scores = new Map([...balances].map(([id, b]) => [id, c.kind === "top_receivers" ? b.received : b.given] as const));
      return rankTopN(pick(scores, s.eligible), c.n, rule.ties);
    }
    case "distinct_receivers": {
      const winners: MemberId[] = [];
      for (const [giver, row] of pick(netPairs(inPeriod), s.eligible)) if ([...row.values()].filter((n) => n > 0).length >= c.k) winners.push(giver);
      return winners.sort(byId);
    }
    case "giving_streak": {
      const gaveIn: Set<MemberId>[] = [];
      let p: string | null = period;
      for (let i = 0; i < c.periods && p !== null; i++) {
        const r = rulePeriodRange(rule.period, p, tz);
        if (r === null) return [];
        gaveIn.push(new Set([...replay(s.entries.filter(within(r)))].filter(([, b]) => b.given > 0).map(([id]) => id)));
        p = previousRulePeriod(rule.period, p);
      }
      const [latest = new Set<MemberId>(), ...earlier] = gaveIn;
      return [...latest].filter((id) => s.eligible.has(id) && earlier.every((set) => set.has(id))).sort(byId);
    }
    case "most_tagged": {
      const scores = new Map<MemberId, number>();
      for (const e of inPeriod) {
        if (!isGiftKind(e) || e.cause.type !== "gift") continue;
        if (!(s.giftValues.get(e.cause.giftId) ?? []).includes(c.valueId)) continue;
        scores.set(e.memberId, (scores.get(e.memberId) ?? 0) + signedAmount(e));
      }
      return rankTopN(pick(scores, s.eligible), 1, rule.ties);
    }
  }
}

/** S61-S63: evaluate a rule after its period closed; awards are rule_award entries (redeemable only). */
export function decideEvaluateRule(s: EvaluateRuleSnapshot, cmd: EvaluateRule, now: Instant): RuleDecision<RuleAwardResult> {
  if (!isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  const rule = s.rule;
  if (rule === null) return fail({ code: "not_found", what: "rule" });
  if (!rule.active) return fail({ code: "rule_inactive" });
  const range = rulePeriodRange(rule.period, cmd.period, s.settings.timezone);
  if (range === null) return fail({ code: "invalid_field", field: "period" });
  if (now < range.end) return fail({ code: "period_not_closed", closesAt: range.end });
  if (s.alreadyAwarded) return fail({ code: "already_evaluated" });

  const winners = ruleWinners(rule, cmd.period, s);
  const entries: NewEntry[] = winners.map((memberId) => ({
    kind: "rule_award",
    amount: rule.reward,
    memberId,
    counterpartId: null,
    cause: { type: "rule", ruleId: rule.id, period: cmd.period },
    source: null,
    allowanceDay: null,
    reason: rule.name,
  }));
  const result: RuleAwardResult = { ruleId: rule.id, period: cmd.period, winners, amount: rule.reward };
  return ok(result, { entries, events: [{ type: "rule.awarded", ...result, announceChannel: rule.announceChannel }] });
}

const PERIODS: readonly RulePeriodKind[] = ["week", "month", "quarter"];

function invalidCriterion(c: RuleCriterion, values: readonly Value[]): ReturnType<typeof fail> | null {
  switch (c.kind) {
    case "top_receivers":
    case "top_givers":
      return isPosInt(c.n) ? null : fail({ code: "invalid_field", field: "criterion.n" });
    case "distinct_receivers":
      return isPosInt(c.k) ? null : fail({ code: "invalid_field", field: "criterion.k" });
    case "giving_streak":
      return isPosInt(c.periods) ? null : fail({ code: "invalid_field", field: "criterion.periods" });
    case "most_tagged":
      return values.some((v) => v.id === c.valueId) ? null : fail({ code: "not_found", what: "value" });
  }
}

/** S60: an admin defines (or replaces) a rule. */
export function decideDefineAwardRule(s: { readonly values: readonly Value[] }, cmd: DefineAwardRule, _now: Instant): RuleDecision<{ ruleId: string }> {
  if (!isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  const r = cmd.rule;
  if (r.id.trim() === "") return fail({ code: "invalid_field", field: "id" });
  if (r.name.trim() === "") return fail({ code: "invalid_field", field: "name" });
  if (!PERIODS.includes(r.period)) return fail({ code: "invalid_field", field: "period" });
  if (!isPosInt(r.reward)) return fail({ code: "invalid_field", field: "reward" });
  const bad = invalidCriterion(r.criterion, s.values);
  if (bad) return bad;
  const rule: AwardRule = { ...r, ties: r.ties ?? "all_win", active: r.active ?? true };
  return ok({ ruleId: r.id }, { writes: [{ t: "rule.upsert", rule }] });
}
