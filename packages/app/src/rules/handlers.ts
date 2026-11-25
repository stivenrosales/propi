// Award rule use cases (S60-S63): lock -> claim -> load -> decide -> commit.
import type { CommandKey, Decision, Directory, GiftId, Instant, LedgerEntry, MemberId, Reader, ValueId, WorkspaceId } from "@propi/core";
import { defineHandler } from "../handler.ts";
import {
  decideDefineAwardRule,
  decideEvaluateRule,
  ruleKey,
  rulePeriodRange,
  rulesDue,
  ruleWindow,
  type DefineAwardRule,
  type EvaluateRule,
  type EvaluateRuleSnapshot,
  type ModuleDecision,
  type RuleAwardResult,
  type RuleStore,
} from "./core.ts";

export interface RuleDeps {
  readonly reader: Reader;
  readonly rules: RuleStore;
}

export type RuleResults = {
  DefineAwardRule: { ruleId: string };
  EvaluateRule: RuleAwardResult;
};

/** Engagement decisions carry their own event/write/error unions until shared/decision.ts includes them. */
const widen = <T>(d: ModuleDecision<T, unknown, unknown>): Decision<T> => d as unknown as Decision<T>;

export async function activeMembers(directory: Directory, ws: WorkspaceId): Promise<Set<MemberId>> {
  return new Set((await directory.members(ws)).filter((r) => r.active).map((r) => r.id));
}

export function ruleHandlers(deps: RuleDeps) {
  return [
    defineHandler<DefineAwardRule, { values: Awaited<ReturnType<Directory["values"]>> }, RuleResults["DefineAwardRule"]>({
      type: "DefineAwardRule",
      locks: () => [],
      load: async (cmd, _tx, ctx) => ({ values: await ctx.directory.values(cmd.workspaceId) }),
      decide: (s, cmd, now) => widen(decideDefineAwardRule(s, cmd, now)),
    }),

    defineHandler<EvaluateRule, EvaluateRuleSnapshot, RuleResults["EvaluateRule"]>({
      type: "EvaluateRule",
      // Awards only credit, so no balance lock is needed; the (rule, period) key is the guard (S62).
      locks: () => [],
      // S62: the (rule, period) key is used only once the period closed, so an early attempt
      // (refused with period_not_closed) cannot consume it.
      async resolveKey(cmd, _tx, ctx) {
        const rule = await deps.rules.rule(cmd.workspaceId, cmd.ruleId);
        const range = rule === null ? null : rulePeriodRange(rule.period, cmd.period, ctx.settings.timezone);
        const key = ruleKey(cmd.ruleId, cmd.period);
        return range !== null && ctx.now >= range.end ? key : (`${key}:early` as CommandKey);
      },
      async load(cmd, _tx, ctx) {
        const ws = cmd.workspaceId;
        const rule = await deps.rules.rule(ws, cmd.ruleId);
        const reader = deps.reader.workspace(ws);
        const all = await reader.entries();
        const window = rule === null ? null : ruleWindow(rule, cmd.period, ctx.settings.timezone);
        const entries: LedgerEntry[] = window === null ? [] : all.filter((e) => e.at >= window.start && e.at < window.end);
        const giftValues = new Map<GiftId, readonly ValueId[]>();
        for (const e of entries) {
          if (e.cause.type !== "gift" || giftValues.has(e.cause.giftId)) continue;
          giftValues.set(e.cause.giftId, (await reader.gift(e.cause.giftId))?.valueIds ?? []);
        }
        const alreadyAwarded = all.some((e) => e.kind === "rule_award" && e.cause.type === "rule" && e.cause.ruleId === cmd.ruleId && e.cause.period === cmd.period);
        return { settings: ctx.settings, rule, entries, giftValues, eligible: await activeMembers(ctx.directory, ws), alreadyAwarded };
      },
      decide: (s, cmd, now) => widen(decideEvaluateRule(s, cmd, now)),
    }),
  ];
}

/** S61: the EvaluateRule commands the scheduler should execute now (keys make re-runs replay). */
export async function dueRuleEvaluations(deps: RuleDeps & { readonly directory: Directory }, ws: WorkspaceId, now: Instant): Promise<EvaluateRule[]> {
  const settings = await deps.directory.settings(ws);
  return rulesDue(await deps.rules.rules(ws), now, settings.timezone, ws);
}
