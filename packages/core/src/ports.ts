// Port types (G3). Core declares them; packages/app wires them; adapters implement them.
import type { Decision } from "./shared/decision.ts";
import type { LockKey } from "./shared/locks.ts";
import type { Actor, CommandKey, GiftId, Instant, LocalDate, MemberId, Outcome, WorkspaceId } from "./shared/types.ts";
import type { Gift } from "./giving/types.ts";
import type { LedgerEntry } from "./ledger/entries.ts";
import type { Balances } from "./ledger/replay.ts";
import type { MemberRecord } from "./members/members.ts";
import type { Value } from "./values/values.ts";
import type { WorkspaceSettings } from "./workspace/settings.ts";

/** One row of `command_log`: the idempotency record, the stored result and the audit trail (S17, S40). */
export interface CommandLogRecord {
  readonly workspaceId: WorkspaceId;
  readonly key: CommandKey;
  readonly requestHash: string;
  readonly commandType: string;
  readonly actor: Actor;
  readonly at: Instant;
  readonly command: unknown;
  readonly result: Outcome<unknown>;
}

/** G2: the outcome of claiming a command key before deciding. */
export type Claim =
  | { readonly status: "claimed" }
  | { readonly status: "done"; readonly requestHash: string; readonly result: Outcome<unknown> };

/** Everything one command persists, atomically. */
export interface Commit<T = unknown> {
  readonly key: CommandKey;
  readonly requestHash: string;
  readonly commandType: string;
  readonly actor: Actor;
  readonly at: Instant;
  readonly command: unknown;
  readonly decision: Decision<T>;
}

/** Reads over one workspace's ledger and gift headers. Used inside a Tx and by queries. */
export interface LedgerReader {
  balances(member: MemberId): Promise<Balances>;
  allowanceUsed(giver: MemberId, day: LocalDate): Promise<number>;
  netPerReceiver(gift: GiftId): Promise<ReadonlyMap<MemberId, number>>;
  gift(id: GiftId): Promise<Gift | null>;
  /** The message-sourced gift attached to a platform message, if any. */
  giftByMessage(messageRef: string): Promise<Gift | null>;
  /** The giver's reaction gift on (message, emoji) that receivers still hold (net > 0), if any (S20). */
  activeReactionGift(giver: MemberId, messageRef: string, emoji: string): Promise<Gift | null>;
  /** Whether an admin reversed (closed) any of the giver's reaction gifts on (message, emoji) (S38). */
  reactionClosedByAdmin(giver: MemberId, messageRef: string, emoji: string): Promise<boolean>;
  /** How many of the giver's reaction gifts on (message, emoji) were reversed on `day` (G8). */
  reactionReversals(giver: MemberId, messageRef: string, emoji: string, day: LocalDate): Promise<number>;
  /** Redeemable per member that has any ledger entry (S39). */
  redeemableByMember(): Promise<ReadonlyMap<MemberId, number>>;
}

/** One atomic unit: reads, the G2 claim, and the final commit. */
export interface Tx extends LedgerReader {
  /** G2: claim the key (insert 'running'); if already done, return its stored result instead. */
  claim(key: CommandKey, requestHash: string): Promise<Claim>;
  /** Persist entries, state writes, events and the command result together, or nothing. */
  commit<T>(c: Commit<T>): Promise<void>;
}

export interface UnitOfWork {
  /** Acquire `locks` in the given (already ordered) order, run `fn` in one transaction, release. */
  run<T>(ws: WorkspaceId, locks: readonly LockKey[], fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface WorkspaceReader extends LedgerReader {
  entries(): Promise<readonly LedgerEntry[]>;
  commandLog(): Promise<readonly CommandLogRecord[]>;
}

/** Read-only queries; they never lock. */
export interface Reader {
  workspace(ws: WorkspaceId): WorkspaceReader;
}

/** Configuration and people (S5-S8, S25, S41). */
export interface Directory {
  settings(ws: WorkspaceId): Promise<WorkspaceSettings>;
  member(ws: WorkspaceId, id: MemberId): Promise<MemberRecord | null>;
  members(ws: WorkspaceId): Promise<readonly MemberRecord[]>;
  values(ws: WorkspaceId): Promise<readonly Value[]>;
}

export interface Clock {
  now(): Instant;
}

export interface Ids {
  /** A new unique id (UUIDv7 in production). */
  next(kind: string): string;
}

export interface Ports {
  readonly uow: UnitOfWork;
  readonly reader: Reader;
  readonly directory: Directory;
  readonly clock: Clock;
  readonly ids: Ids;
}
