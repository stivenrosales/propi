// @propi/app — use cases and queries over the pure core (G3).
export * from "@propi/core";
export { createApp, type AllowanceView, type App, type CreateAppOptions, type LedgerCheck, type ResultOf } from "./create-app.ts";
export { defineHandler, type CommandHandler, type HandlerClock, type LoadContext, type LockContext, type RegisteredHandler } from "./handler.ts";
export { HANDLERS, type AppCommand, type AppResults } from "./registry.ts";
export { requestHash } from "./hash.ts";

// Billing and plans (S6, S7).
export { syncSeats, workspacePlan, type PlanDeps, type SeatSyncReport } from "./billing/index.ts";
// Shop (S44-S59, S108).
export * from "./shop/index.ts";
// Engagement (S60-S68, S73-S79, S92-S96).
export { engagementHandlers, type EngagementDeps } from "./engagement.ts";
export * from "./rules/index.ts";
export * from "./quests/index.ts";
export * from "./stickers/index.ts";
export * from "./levels/index.ts";
export * from "./milestones/index.ts";
export * from "./pairing/index.ts";
// Insights and communications (S41-S43, S69-S72, S80-S91).
export * from "./boards/index.ts";
export * from "./notify/index.ts";
export * from "./insights/index.ts";
export * from "./privacy/index.ts";
export * from "./values/index.ts";
// Public API and identities (S97-S100, S106, S107).
export * from "./api/index.ts";
