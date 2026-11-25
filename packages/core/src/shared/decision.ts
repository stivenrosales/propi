// What a pure decider returns. The app shell persists all of it atomically, or nothing.
import type { GivingEvent, GivingWrite } from "../giving/types.ts";
import type { NewEntry } from "../ledger/entries.ts";
import type { LedgerEvent } from "../ledger/commands.ts";
import type { ShopEvent } from "../shop/types.ts";
import type { RuleEvent } from "../rules/types.ts";
import type { QuestEvent } from "../quests/types.ts";
import type { MilestoneEvent } from "../milestones/milestones.ts";
import type { PairingEvent } from "../pairing/pairing.ts";
import { MAX_ENTRY_AMOUNT, type DomainError, type Outcome } from "./types.ts";

/** Outbox events. One line per module. Stickers emit the giving `gift.given`; levels emit none. */
export type DomainEvent =
  | GivingEvent
  | LedgerEvent
  | ShopEvent
  | RuleEvent
  | QuestEvent
  | MilestoneEvent
  | PairingEvent;

/**
 * Non-ledger state writes that every adapter applies (exhaustive WRITE_APPLIERS in the memory and
 * Postgres ports). Shop and engagement writes (ShopWrite, RuleWrite, QuestWrite, ...) are applied by
 * their own stores until the Postgres adapter implements them; then they join this union.
 */
export type StateWrite = GivingWrite;

export interface Decision<T> {
  readonly outcome: Outcome<T>;
  readonly entries: readonly NewEntry[];
  readonly writes: readonly StateWrite[];
  readonly events: readonly DomainEvent[];
}

export function accept<T>(value: T, parts: Partial<Omit<Decision<T>, "outcome">> = {}): Decision<T> {
  return { outcome: { ok: true, value }, entries: parts.entries ?? [], writes: parts.writes ?? [], events: parts.events ?? [] };
}

/** A rejection moves nothing; it may still emit events (e.g. the S13 private notice). */
export function reject<T = never>(error: DomainError, events: readonly DomainEvent[] = []): Decision<T> {
  return { outcome: { ok: false, error }, entries: [], writes: [], events };
}

/**
 * The entry cap (MAX_ENTRY_AMOUNT). The app applies it to every decision before commit, so no module
 * can write an entry big enough to overflow a balance column, whatever its own input checks.
 */
export function capEntries<T>(d: Decision<T>): Decision<T> {
  return d.entries.some((e) => e.amount > MAX_ENTRY_AMOUNT) ? reject({ code: "amount_too_large", max: MAX_ENTRY_AMOUNT }) : d;
}
