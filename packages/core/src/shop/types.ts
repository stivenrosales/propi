// Shop: catalog, redemptions, collaborative rewards and gift cards (S44-S59, S108).
// Types only. The deciders live next to this file.
import type { CommandBase, DomainError, Instant, MemberId, Outcome, PosInt } from "../shared/types.ts";
import type { NewEntry } from "../ledger/entries.ts";
import type { DomainEvent, StateWrite } from "../shared/decision.ts";

export type RewardId = string;
export type VariantId = string;
export type RedemptionId = string;
export type CollabId = string;

/** G10: money is integer minor units (cents) plus an ISO 4217 currency (S44, S47). */
export interface Money {
  readonly minor: number;
  readonly currency: string;
}

// ───────────── Catalog (S44-S46) ─────────────

export type RewardStatus = "draft" | "active" | "archived"; // S45

export interface RewardVariant {
  readonly id: VariantId;
  readonly name: string;
  /** null = unlimited. */
  readonly stock: number | null;
}

export interface Reward {
  readonly id: RewardId;
  readonly title: string;
  readonly description: string;
  readonly image: string | null;
  readonly cost: PosInt; // units
  /** Stock of a reward without variants; null = unlimited. Ignored when variants exist. */
  readonly stock: number | null;
  readonly variants: readonly RewardVariant[];
  readonly categories: readonly string[];
  /** Admin-only internal monetary cost (S44); what the S47 budget and the S108 prepaid balance count. */
  readonly internalCost: Money | null;
  readonly instructions: string;
  readonly status: RewardStatus;
  /** S52: per-reward auto-approval; null follows the workspace setting. */
  readonly autoApprove: boolean | null;
  /** S108: fulfilled through the gift-card provider. */
  readonly giftCard: boolean;
  readonly createdAt: Instant;
}

/** The workspace's shop configuration. */
export interface ShopSettings {
  readonly autoApprove: boolean; // S52 (global)
  readonly monthlyBudget: Money | null; // S47
}

export const DEFAULT_SHOP_SETTINGS: ShopSettings = { autoApprove: false, monthlyBudget: null };

// ───────────── Redemptions (S49-S55) ─────────────

export type RedemptionState = "pending" | "approved" | "fulfilled" | "rejected" | "cancelled";
export type RedemptionTransition = "approve" | "reject" | "cancel" | "fulfil";

/** S49: the only legal edges (docs/statecharts/redemption). Rejection and cancellation refund (S51). */
export const REDEMPTION_EDGES = {
  pending: ["approved", "rejected"],
  approved: ["fulfilled", "cancelled"],
  fulfilled: [],
  rejected: [],
  cancelled: [],
} as const satisfies Readonly<Record<RedemptionState, readonly RedemptionState[]>>;

export const TRANSITION_TARGET: Readonly<Record<RedemptionTransition, RedemptionState>> = {
  approve: "approved",
  reject: "rejected",
  cancel: "cancelled",
  fulfil: "fulfilled",
};

/** States that hold the debit, the stock unit and the budget (StockConserved in Redemption.tla). */
export const HELD_STATES: readonly RedemptionState[] = ["pending", "approved", "fulfilled"];

export type OnBehalfOf = "self" | { readonly admin: MemberId } | { readonly collab: CollabId }; // S55, S57

export interface Redemption {
  readonly id: RedemptionId;
  /** The member who was debited; null for a collaborative (group) redemption. */
  readonly memberId: MemberId | null;
  readonly rewardId: RewardId | null;
  readonly variantId: VariantId | null;
  readonly collabId: CollabId | null;
  readonly cost: PosInt;
  readonly internalCost: Money | null;
  /** The "YYYY-MM" budget month the internal cost counts against; null when not budgeted. */
  readonly budgetMonth: string | null;
  /** Whether a stock unit was reserved (and must be released on refund). */
  readonly stockReserved: boolean;
  readonly giftCard: boolean;
  /** S108: set once the provider issued the card. */
  readonly cardIssued: boolean;
  readonly onBehalfOf: OnBehalfOf;
  readonly state: RedemptionState;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly reason: string | null;
}

// ───────────── Collaborative rewards (S56-S59) ─────────────

export type CollabPhase = "open" | "completed" | "delivered" | "refunded"; // docs/statecharts/collab

export interface Collab {
  readonly id: CollabId;
  readonly title: string;
  readonly description: string;
  readonly goal: PosInt;
  readonly deadline: Instant | null;
  readonly autoApprove: boolean;
  readonly phase: CollabPhase;
  readonly redemptionId: RedemptionId | null;
  readonly createdAt: Instant;
}

// ───────────── Commands ─────────────

export interface RewardInput {
  readonly title: string;
  readonly description: string;
  readonly image: string | null;
  readonly cost: number;
  readonly stock: number | null;
  readonly variants: readonly RewardVariant[];
  readonly categories: readonly string[];
  readonly internalCost: Money | null;
  readonly instructions: string;
  readonly autoApprove: boolean | null;
  readonly giftCard: boolean;
}

export interface ConfigureShop extends CommandBase {
  readonly type: "ConfigureShop";
  readonly settings: ShopSettings;
}
export interface CreateReward extends CommandBase {
  readonly type: "CreateReward";
  readonly reward: RewardInput;
}
/** S44, S97: the editable fields of a reward. Stock goes through Restock, status through SetRewardStatus. */
export type RewardChanges = Partial<Pick<RewardInput, "title" | "description" | "image" | "cost" | "categories" | "internalCost" | "instructions" | "autoApprove">>;
export interface UpdateReward extends CommandBase {
  readonly type: "UpdateReward";
  readonly rewardId: RewardId;
  readonly changes: RewardChanges;
}
export interface SetRewardStatus extends CommandBase {
  readonly type: "SetRewardStatus";
  readonly rewardId: RewardId;
  readonly status: "active" | "archived";
}
export interface Restock extends CommandBase {
  readonly type: "Restock";
  readonly rewardId: RewardId;
  readonly variantId: VariantId | null;
  readonly quantity: PosInt;
}
/** S48: one platform-agnostic command; chat (App Home / modal) and web send the same shape. */
export interface Redeem extends CommandBase {
  readonly type: "Redeem";
  readonly memberId: MemberId;
  readonly rewardId: RewardId;
  readonly variantId: VariantId | null;
}
export interface TransitionRedemption extends CommandBase {
  readonly type: "TransitionRedemption";
  readonly redemptionId: RedemptionId;
  readonly transition: RedemptionTransition;
  readonly reason: string | null;
}
/** S108: the gift-card relay records that the provider issued the card. */
export interface RecordGiftCardIssued extends CommandBase {
  readonly type: "RecordGiftCardIssued";
  readonly redemptionId: RedemptionId;
}
export interface CreateCollab extends CommandBase {
  readonly type: "CreateCollab";
  readonly title: string;
  readonly description: string;
  readonly goal: number;
  readonly deadline: Instant | null;
  readonly autoApprove: boolean;
}
export interface Contribute extends CommandBase {
  readonly type: "Contribute";
  readonly collabId: CollabId;
  readonly memberId: MemberId;
  readonly amount: number;
}
/** S58: archived by an admin, or closed by the scheduler once the deadline passed. */
export interface CloseCollab extends CommandBase {
  readonly type: "CloseCollab";
  readonly collabId: CollabId;
  readonly why: "archived" | "deadline";
}

export type ShopCommand =
  | ConfigureShop
  | CreateReward
  | UpdateReward
  | SetRewardStatus
  | Restock
  | Redeem
  | TransitionRedemption
  | RecordGiftCardIssued
  | CreateCollab
  | Contribute
  | CloseCollab;

// ───────────── Results ─────────────

export interface RedemptionReceipt {
  readonly redemptionId: RedemptionId;
  readonly state: RedemptionState;
  readonly cost: number;
  /** The member's redeemable after the debit (S50). */
  readonly redeemable: number;
}
export interface TransitionReceipt {
  readonly redemptionId: RedemptionId;
  readonly state: RedemptionState;
  /** False for the S53 idempotent re-fulfil. */
  readonly changed: boolean;
  readonly refunded: number;
}
export interface ContributionReceipt {
  readonly collabId: CollabId;
  /** S59: what was actually taken, capped at goal - raised. */
  readonly taken: number;
  readonly raised: number;
  readonly goal: number;
  readonly redemptionId: RedemptionId | null;
}
export interface CollabRefundReceipt {
  readonly collabId: CollabId;
  readonly members: number;
  readonly refunded: number;
}

export type ShopResults = {
  ConfigureShop: ShopSettings;
  CreateReward: { rewardId: RewardId };
  UpdateReward: { rewardId: RewardId };
  SetRewardStatus: { rewardId: RewardId; status: RewardStatus };
  Restock: { rewardId: RewardId; variantId: VariantId | null; stock: number };
  Redeem: RedemptionReceipt;
  TransitionRedemption: TransitionReceipt;
  RecordGiftCardIssued: { redemptionId: RedemptionId };
  CreateCollab: { collabId: CollabId };
  Contribute: ContributionReceipt;
  CloseCollab: CollabRefundReceipt;
};

// ───────────── Errors, events, writes ─────────────

export type ShopError =
  | { readonly code: "insufficient_redeemable"; readonly cost: number; readonly redeemable: number } // S35, S50
  | { readonly code: "out_of_stock" } // S46
  | { readonly code: "budget_exceeded"; readonly remaining: Money } // S47
  | { readonly code: "prepaid_insufficient"; readonly available: Money } // S108
  | { readonly code: "reward_not_found" }
  | { readonly code: "reward_not_active" } // S45
  | { readonly code: "invalid_variant" }
  | { readonly code: "invalid_reward"; readonly field: string } // S44
  | { readonly code: "illegal_reward_transition"; readonly from: RewardStatus; readonly to: RewardStatus } // S45
  | { readonly code: "redemption_not_found" }
  | { readonly code: "illegal_transition"; readonly from: RedemptionState; readonly transition: RedemptionTransition } // S49
  | { readonly code: "collab_not_found" }
  | { readonly code: "collab_closed" } // S58
  | { readonly code: "deadline_not_reached" }; // S58

export type RedemptionEventType = `redemption.${"created" | "approved" | "rejected" | "cancelled" | "fulfilled"}`;

export type ShopEvent =
  | {
      // S54: every state change; `notify` are the members to DM privately.
      readonly type: RedemptionEventType;
      readonly redemptionId: RedemptionId;
      readonly rewardId: RewardId | null;
      readonly collabId: CollabId | null;
      readonly cost: number;
      readonly notify: readonly MemberId[];
    }
  | { readonly type: "collab.contributed"; readonly collabId: CollabId; readonly memberId: MemberId; readonly amount: number; readonly raised: number; readonly goal: number } // S56
  | { readonly type: "collab.completed"; readonly collabId: CollabId; readonly redemptionId: RedemptionId; readonly notify: readonly MemberId[] } // S57
  | { readonly type: "collab.refunded"; readonly collabId: CollabId; readonly why: "archived" | "deadline" | "rejected" | "cancelled"; readonly notify: readonly MemberId[]; readonly total: number }; // S58

/** Non-ledger shop writes. Stock and state changes are compare-and-set, as in architecture §1.4. */
export type ShopWrite =
  | { readonly t: "shop.settings.put"; readonly settings: ShopSettings }
  | { readonly t: "shop.reward.insert"; readonly reward: Reward }
  | { readonly t: "shop.reward.status"; readonly rewardId: RewardId; readonly from: RewardStatus; readonly to: RewardStatus }
  /** Field edit; CAS on the status it was decided against (an archived reward is never edited). */
  | { readonly t: "shop.reward.update"; readonly from: RewardStatus; readonly reward: Reward }
  /** Conditional decrement: fails the transaction when stock is 0. */
  | { readonly t: "shop.stock.take"; readonly rewardId: RewardId; readonly variantId: VariantId | null }
  | { readonly t: "shop.stock.add"; readonly rewardId: RewardId; readonly variantId: VariantId | null; readonly quantity: number }
  /** `from` null = insert (must not exist); otherwise CAS on the current state. */
  | { readonly t: "shop.redemption.put"; readonly from: RedemptionState | null; readonly redemption: Redemption }
  | { readonly t: "shop.collab.put"; readonly from: CollabPhase | null; readonly collab: Collab };

export const isShopWrite = (w: { readonly t: string }): w is ShopWrite => w.t.startsWith("shop.");

/**
 * A shop decision. Same shape as core's Decision; its unions add the shop's errors, events
 * and writes. Once ShopError/ShopEvent/ShopWrite join DomainError/DomainEvent/StateWrite,
 * it is exactly a Decision<T>.
 */
export interface ShopDecision<T> {
  readonly outcome: Outcome<T> | { readonly ok: false; readonly error: ShopError };
  readonly entries: readonly NewEntry[];
  readonly writes: readonly (StateWrite | ShopWrite)[];
  readonly events: readonly (DomainEvent | ShopEvent)[];
}

export type ShopFailure = DomainError | ShopError;
