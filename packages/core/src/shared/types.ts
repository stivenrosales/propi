// Shared primitive types of the domain. Pure TypeScript, no runtime dependencies.

import type { ShopError } from "../shop/types.ts";
import type { EngagementError } from "../rules/module-decision.ts";

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type WorkspaceId = Brand<string, "WorkspaceId">;
export type MemberId = Brand<string, "MemberId">;
export type GiftId = Brand<string, "GiftId">;
export type ValueId = Brand<string, "ValueId">;
export type ApiTokenId = Brand<string, "ApiTokenId">;

/** Integer >= 1. Every ledger magnitude, cost and emoji value is one. */
export type PosInt = Brand<number, "PosInt">;
export const posInt = (n: number): PosInt | null => (Number.isSafeInteger(n) && n >= 1 ? (n as PosInt) : null);
export const isPosInt = (n: number): n is PosInt => Number.isSafeInteger(n) && n >= 1;

/**
 * The largest magnitude one ledger entry may carry. Keeps every amount far from integer overflow in
 * storage and replay; a decision that would write a bigger entry is refused with `amount_too_large`.
 * Balances are sums of many entries, so adapters must still sum as 64-bit integers.
 */
export const MAX_ENTRY_AMOUNT = 1_000_000;
export const isEntryAmount = (n: number): n is PosInt => isPosInt(n) && n <= MAX_ENTRY_AMOUNT;
/** Splits a positive total into entry amounts of at most MAX_ENTRY_AMOUNT each, largest first. */
export function entryAmounts(total: PosInt): PosInt[] {
  const out: PosInt[] = [];
  for (let left = total as number; left > 0; left -= MAX_ENTRY_AMOUNT) out.push(Math.min(left, MAX_ENTRY_AMOUNT) as PosInt);
  return out;
}

/** Epoch milliseconds, UTC. */
export type Instant = Brand<number, "Instant">;
/** Local calendar date in the workspace timezone, "YYYY-MM-DD" (S3, S27). */
export type LocalDate = Brand<string, "LocalDate">;

/**
 * The one idempotency mechanism (S17). Deterministic and namespaced, built by the adapter:
 *   slack:msg:<team>:<channel>:<ts>, slack:react:...:<user>:<emoji>[:<n>], api:<token>:<key>, ...
 */
export type CommandKey = Brand<string, "CommandKey">;

export type Role = "admin" | "approver" | "member"; // S5, S6

export type ApiScope =
  | "members:read"
  | "ledger:read"
  | "rewards:read"
  | "rewards:write"
  | "redemptions:read"
  | "redemptions:write"
  | "adjustments:write"
  | "quests:read"
  | "leaderboards:read";

export type Actor =
  | { readonly kind: "member"; readonly memberId: MemberId; readonly role: Role }
  | { readonly kind: "bot"; readonly platformUserId: string } // S8
  | { readonly kind: "apiToken"; readonly tokenId: ApiTokenId; readonly scopes: readonly ApiScope[] }
  | { readonly kind: "system"; readonly job: string };

export type DomainError =
  | { readonly code: "over_allowance"; readonly cost: number; readonly remaining: number } // S13
  | { readonly code: "not_a_gift" } // silently ignored by adapters
  | { readonly code: "channel_not_allowed" } // S16
  | { readonly code: "inactive_member" } // S7
  | { readonly code: "unknown_member"; readonly memberId: MemberId }
  | { readonly code: "bots_may_not_give" } // S8
  | { readonly code: "forbidden"; readonly need: Role | ApiScope }
  | { readonly code: "invalid_amount" }
  | { readonly code: "amount_too_large"; readonly max: number } // MAX_ENTRY_AMOUNT
  | { readonly code: "reason_required" } // S37
  | { readonly code: "gift_not_found" }
  | { readonly code: "gift_closed" } // S23, S24, S38: an admin-reversed or deleted gift is final
  | { readonly code: "invalid_currency"; readonly field: "primaryEmoji" | "singular" | "plural" | "extraEmojis" }
  | { readonly code: "idempotency_key_reused"; readonly originalRequestHash: string } // G2, S100
  | ShopError
  | EngagementError;

/** What a decider concludes. The app adds `replayed`. */
export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DomainError };
export type Result<T> = Outcome<T> & { readonly replayed: boolean };

/** Fields every command carries. Modules add their own `type` and payload. */
export interface CommandBase {
  readonly key: CommandKey;
  readonly workspaceId: WorkspaceId;
  readonly actor: Actor;
  /** When the source event happened (informational; deciders use `now`). */
  readonly at: Instant;
}
