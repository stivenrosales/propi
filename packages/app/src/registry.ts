// The command registry. A new module adds its handlers, commands and results here: one line each.
// Engagement handlers (rules, quests, stickers, levels, milestones, pairing) are built from their stores
// at the composition root with engagementHandlers(deps) and passed as createApp's `options.handlers`;
// their commands and results are still typed here, so `execute` accepts them.
import type {
  GivingCommand,
  LedgerCommand,
  LevelCommand,
  MilestoneCommand,
  PairingCommand,
  PrivacyCommand,
  QuestCommand,
  RuleCommand,
  ShopCommand,
  StickerCommand,
  TagGiftByReaction,
} from "@propi/core";
import type { RegisteredHandler } from "./handler.ts";
import { givingHandlers, type GivingResults } from "./giving/handlers.ts";
import { ledgerHandlers, type LedgerResults } from "./ledger/handlers.ts";
import { shopHandlers, type ShopResults } from "./shop/handlers.ts";
import { valuesHandlers, type ValuesResults } from "./values/handlers.ts";
import { privacyHandlers, type PrivacyResults } from "./privacy/handlers.ts";
import type { RuleResults } from "./rules/handlers.ts";
import type { QuestResults } from "./quests/handlers.ts";
import type { StickerResults } from "./stickers/handlers.ts";
import type { LevelResults } from "./levels/handlers.ts";
import type { MilestoneResults } from "./milestones/handlers.ts";
import type { PairingResults } from "./pairing/handlers.ts";

export const HANDLERS: readonly RegisteredHandler[] = [
  ...givingHandlers,
  ...ledgerHandlers,
  ...shopHandlers,
  ...valuesHandlers,
  ...privacyHandlers,
];

export type AppCommand =
  | GivingCommand
  | LedgerCommand
  | ShopCommand
  | TagGiftByReaction
  | PrivacyCommand
  | RuleCommand
  | QuestCommand
  | StickerCommand
  | LevelCommand
  | MilestoneCommand
  | PairingCommand;

export type AppResults =
  & GivingResults
  & LedgerResults
  & ShopResults
  & ValuesResults
  & PrivacyResults
  & RuleResults
  & QuestResults
  & StickerResults
  & LevelResults
  & MilestoneResults
  & PairingResults;
