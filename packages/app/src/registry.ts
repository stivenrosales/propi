// The command registry. A new module adds its handlers, commands and results here: one line each.
import type { GivingCommand, LedgerCommand } from "@propi/core";
import type { RegisteredHandler } from "./handler.ts";
import { givingHandlers, type GivingResults } from "./giving/handlers.ts";
import { ledgerHandlers, type LedgerResults } from "./ledger/handlers.ts";

export const HANDLERS: readonly RegisteredHandler[] = [
  ...givingHandlers,
  ...ledgerHandlers,
];

export type AppCommand =
  | GivingCommand
  | LedgerCommand;

export type AppResults =
  & GivingResults
  & LedgerResults;
