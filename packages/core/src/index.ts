// @propi/core — pure domain. No I/O, no clock, no randomness, no dependencies.
export const VERSION = "0.0.0";

export * from "./shared/types.ts";
export * from "./shared/locks.ts";
export * from "./shared/decision.ts";
export * from "./ports.ts";

export * from "./workspace/currency.ts";
export * from "./workspace/settings.ts";
export * from "./workspace/time.ts";

export * from "./members/members.ts";

export * from "./values/values.ts";

export * from "./ledger/entries.ts";
export * from "./ledger/replay.ts";
export * from "./ledger/commands.ts";
export * from "./ledger/adjustments.ts";

export * from "./giving/types.ts";
export * from "./giving/allowance.ts";
export * from "./giving/quote.ts";
export * from "./giving/decide.ts";
