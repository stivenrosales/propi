// What a pure decider returns. The app shell persists all of it atomically, or nothing.
import type { GivingEvent, GivingWrite } from "../giving/types.ts";
import type { NewEntry } from "../ledger/entries.ts";
import type { LedgerEvent } from "../ledger/commands.ts";
import type { DomainError, Outcome } from "./types.ts";

/** Outbox events. One line per module. */
export type DomainEvent = GivingEvent | LedgerEvent;

/** Non-ledger state writes. One line per module. */
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
