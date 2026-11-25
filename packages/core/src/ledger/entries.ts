// S30: ledger entry kinds and shapes, plus the EFFECTS table (G1).
import type { CommandKey, GiftId, Instant, LocalDate, MemberId, PosInt, WorkspaceId } from "../shared/types.ts";

export type EntryKind = "gift" | "gift_reversal" | "bonus" | "rule_award" | "quest_reward" | "spend" | "refund" | "deduction";

export type GiftSource = "message" | "reaction" | "sticker";

/** What caused an entry (S30 "cause"). The acting admin lives on the command log (S40). */
export type Cause =
  | { readonly type: "gift"; readonly giftId: GiftId }
  | { readonly type: "redemption"; readonly redemptionId: string }
  | { readonly type: "contribution"; readonly collabId: string }
  | { readonly type: "rule"; readonly ruleId: string; readonly period: string }
  | { readonly type: "quest"; readonly submissionId: string }
  | { readonly type: "admin" }
  | { readonly type: "milestone"; readonly milestone: "birthday" | "anniversary"; readonly year: number }
  | { readonly type: "import"; readonly source: "heytaco" };

/** An entry as a decider produces it. `amount` is a magnitude; the sign comes from `kind`. */
export interface NewEntry {
  readonly kind: EntryKind;
  readonly amount: PosInt;
  /** Whose redeemable moves (the receiver for gifts). */
  readonly memberId: MemberId;
  /** The giver for gift and gift_reversal; null otherwise. */
  readonly counterpartId: MemberId | null;
  readonly cause: Cause;
  /** Gift entries only. */
  readonly source: GiftSource | null;
  /** Local day whose allowance this consumes (gift) or gives back (gift_reversal); null = none. */
  readonly allowanceDay: LocalDate | null;
  readonly reason: string | null;
}

/** A committed, immutable entry. Entries are never updated or deleted (S30). */
export interface LedgerEntry extends NewEntry {
  readonly seq: number;
  readonly workspaceId: WorkspaceId;
  readonly commandKey: CommandKey;
  readonly ordinal: number;
  readonly at: Instant;
}

export interface Effect {
  readonly sign: 1 | -1;
  readonly received: boolean;
  readonly given: boolean;
  readonly redeemable: boolean;
}

/** G1: the single definition of what each kind moves. Used by replay, SQL aggregates and reconciliation. */
export const EFFECTS = {
  gift: { sign: 1, received: true, given: true, redeemable: true },
  gift_reversal: { sign: -1, received: true, given: true, redeemable: true },
  bonus: { sign: 1, received: false, given: false, redeemable: true },
  rule_award: { sign: 1, received: false, given: false, redeemable: true },
  quest_reward: { sign: 1, received: false, given: false, redeemable: true },
  spend: { sign: -1, received: false, given: false, redeemable: true },
  refund: { sign: 1, received: false, given: false, redeemable: true },
  deduction: { sign: -1, received: false, given: false, redeemable: true },
} as const satisfies Readonly<Record<EntryKind, Effect>>;

export const signedAmount = (e: Pick<NewEntry, "kind" | "amount">): number => EFFECTS[e.kind].sign * e.amount;
