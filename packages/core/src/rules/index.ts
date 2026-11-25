// Award rules (S60-S63), plus the decision shape and period math the engagement modules share.
// Explicit exports: calendar helpers stay internal so `export *` from core/index.ts cannot collide.
export type { EngagementError, ModuleDecision, ModuleOutcome } from "./module-decision.ts";
export {
  lastClosedRulePeriod,
  nextRulePeriod,
  previousRulePeriod,
  rulePeriodOf,
  rulePeriodOfDate,
  rulePeriodRange,
  rulePeriodStart,
  type RulePeriodKind,
  type RulePeriodRange,
} from "./periods.ts";
export * from "./types.ts";
export * from "./evaluate.ts";
