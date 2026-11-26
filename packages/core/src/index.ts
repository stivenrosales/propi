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

export * from "./i18n/locale.ts";

export * from "./values/index.ts";

export * from "./ledger/entries.ts";
export * from "./ledger/replay.ts";
export * from "./ledger/commands.ts";
export * from "./ledger/adjustments.ts";

export * from "./giving/types.ts";
export * from "./giving/allowance.ts";
export * from "./giving/quote.ts";
export * from "./giving/decide.ts";

export * from "./migration/index.ts";

export * from "./shop/index.ts";

export * from "./rules/index.ts";
export * from "./quests/index.ts";
export * from "./stickers/index.ts";
export * from "./levels/index.ts";
export * from "./milestones/index.ts";
export * from "./pairing/index.ts";

export * from "./boards/index.ts";
export * from "./notify/index.ts";
export * from "./insights/index.ts";
export * from "./privacy/index.ts";

export * from "./api/index.ts";
export * from "./identity/index.ts";

export * from "./billing/index.ts";
