// S60-S63: automatic award rules.
import type { CommandBase, GiftId, MemberId, PosInt, ValueId, WorkspaceId } from "../shared/types.ts";
import type { RulePeriodKind } from "./periods.ts";

export type RuleCriterion =
  | { readonly kind: "top_receivers"; readonly n: PosInt }
  | { readonly kind: "top_givers"; readonly n: PosInt }
  /** Gave to at least K distinct people in the period. */
  | { readonly kind: "distinct_receivers"; readonly k: PosInt }
  /** Gave at least one gift in each of P consecutive periods, ending with the evaluated one. */
  | { readonly kind: "giving_streak"; readonly periods: PosInt }
  /** Received the most units through gifts tagged with the value (S42). */
  | { readonly kind: "most_tagged"; readonly valueId: ValueId };

/** S60: all tied members win (default), or a tie that crosses the cut is skipped. */
export type TieHandling = "all_win" | "skip_tied";

export interface AwardRule {
  readonly id: string;
  readonly name: string;
  readonly period: RulePeriodKind;
  readonly criterion: RuleCriterion;
  readonly reward: PosInt;
  readonly ties: TieHandling;
  readonly active: boolean;
  /** S61: where results are announced; null = DMs only. */
  readonly announceChannel: string | null;
}

export type AwardRuleInput = Omit<AwardRule, "ties" | "active"> & { readonly ties?: TieHandling; readonly active?: boolean };

export interface DefineAwardRule extends CommandBase {
  readonly type: "DefineAwardRule";
  readonly rule: AwardRuleInput;
}

/** Keyed `rule:<ruleId>:<period>` (S62); the use case enforces that key. */
export interface EvaluateRule extends CommandBase {
  readonly type: "EvaluateRule";
  readonly ruleId: string;
  readonly period: string;
}

export type RuleCommand = DefineAwardRule | EvaluateRule;

export interface RuleAwardResult {
  readonly ruleId: string;
  readonly period: string;
  readonly winners: readonly MemberId[];
  readonly amount: number;
}

export type RuleEvent = {
  readonly type: "rule.awarded";
  readonly ruleId: string;
  readonly period: string;
  readonly winners: readonly MemberId[];
  readonly amount: number;
  readonly announceChannel: string | null;
}; // S61, S99

export type RuleWrite = { readonly t: "rule.upsert"; readonly rule: AwardRule };

/** Read port for rule definitions (implemented by packages/db and the in-memory fake). */
export interface RuleStore {
  rules(ws: WorkspaceId): Promise<readonly AwardRule[]>;
  rule(ws: WorkspaceId, id: string): Promise<AwardRule | null>;
}

/** Gift headers' value tags, for `most_tagged`. */
export type RuleGiftValues = ReadonlyMap<GiftId, readonly ValueId[]>;
