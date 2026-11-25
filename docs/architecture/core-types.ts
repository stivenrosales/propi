// core-types.ts — sketch of @recog/core public types (candidate 3).
// Pure TypeScript. No I/O, no runtime dependencies. Everything effectful is a port.

// ───────────────────────── Brands ─────────────────────────
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type WorkspaceId = Brand<string, "WorkspaceId">;
export type MemberId = Brand<string, "MemberId">;
export type GiftId = Brand<string, "GiftId">;
export type RewardId = Brand<string, "RewardId">;
export type VariantId = Brand<string, "VariantId">;
export type RedemptionId = Brand<string, "RedemptionId">;
export type CollabId = Brand<string, "CollabId">;
export type RuleId = Brand<string, "RuleId">;
export type QuestId = Brand<string, "QuestId">;
export type SubmissionId = Brand<string, "SubmissionId">;
export type ValueId = Brand<string, "ValueId">;
export type StickerId = Brand<string, "StickerId">;
export type ApiTokenId = Brand<string, "ApiTokenId">;

/** Integer ≥ 1. Every ledger magnitude, cost and emoji value is one. */
export type PosInt = Brand<number, "PosInt">;
export const posInt = (n: number): PosInt | null => (Number.isSafeInteger(n) && n >= 1 ? (n as PosInt) : null);

/** Money in minor units (céntimos). Only for internal reward cost and budgets (S44, S47). */
export type Money = { readonly minor: number; readonly currency: string };

/** Local calendar date in the workspace timezone, "YYYY-MM-DD" (S3, S27). */
export type LocalDate = Brand<string, "LocalDate">;
/** Period key: "2026-W48", "2026-11", "2026-Q4" (S60, S75). */
export type PeriodKey = Brand<string, "PeriodKey">;
export type Instant = Brand<number, "Instant">; // epoch ms, UTC

/**
 * The one idempotency mechanism (S17, S62, S100, S105). Deterministic, namespaced:
 *   slack:msg:<team>:<channel>:<ts>                 message gift
 *   slack:edit:<team>:<channel>:<ts>:<editTs>       edit recompute
 *   slack:del:<team>:<channel>:<ts>                 delete
 *   slack:react:<team>:<channel>:<ts>:<user>:<emoji> reaction gift (S20: once per giver/message/emoji)
 *   slack:unreact:<team>:<channel>:<ts>:<user>:<emoji>
 *   api:<tokenId>:<clientKey>                       REST write (S100)
 *   rule:<ruleId>:<periodKey>                       rule evaluation (S62)
 *   job:<jobName>:<periodKey>                       reports, nudges, pairing, milestones
 *   import:heytaco:<kind>:<rowHash>:<occurrence>    import row (S105)
 *   redemption:<id>:<transition>                    internal follow-ups
 */
export type CommandKey = Brand<string, "CommandKey">;

// ───────────────────────── Actors ─────────────────────────
export type Role = "admin" | "approver" | "member"; // S5, S6
export type Actor =
  | { readonly kind: "member"; readonly memberId: MemberId; readonly role: Role }
  | { readonly kind: "bot"; readonly platformUserId: string } // S8: may give if setting ON, never receives
  | { readonly kind: "apiToken"; readonly tokenId: ApiTokenId; readonly scopes: readonly ApiScope[] } // S98
  | { readonly kind: "system"; readonly job: string } // scheduler, importer
  ;
export type ApiScope =
  | "members:read" | "ledger:read" | "rewards:read" | "rewards:write"
  | "redemptions:read" | "redemptions:write" | "adjustments:write" | "quests:read" | "leaderboards:read";

// ───────────────────────── Workspace config ─────────────────────────
export interface Currency { // S1, S2
  readonly primaryEmoji: string; // ":taco:"
  readonly singular: string;
  readonly plural: string;
  readonly extraEmojis: ReadonlyMap<string, PosInt>; // ":fire:" -> 3
}
export interface WorkspaceSettings {
  readonly timezone: string; // IANA (S3)
  readonly currency: Currency;
  readonly defaultDailyAllowance: PosInt; // S25
  readonly adminDailyAllowance: PosInt; // S26
  readonly reactionsEnabled: boolean; // S18
  readonly groupMentionsEnabled: boolean; // S12 (default true)
  readonly privateChannelsAllowed: boolean; // S16
  readonly showPrivateGifts: boolean; // S69
  readonly storeMessageText: boolean; // S70
  readonly botsMayGive: boolean; // S8
  readonly giverMode: boolean; // S81
  readonly autoApproveRedemptions: boolean; // S52
  readonly monthlyBudget: Money | null; // S47
  readonly stickersEnabled: boolean; // S73
  readonly nudgeEnabled: boolean; // S86
  readonly milestoneBonus: { readonly birthday: PosInt | null; readonly anniversary: PosInt | null }; // S94
}

// ───────────────────────── Ledger ─────────────────────────
/** What caused an entry (S30 "cause"). */
export type Cause =
  | { readonly type: "gift"; readonly giftId: GiftId }
  | { readonly type: "redemption"; readonly redemptionId: RedemptionId }
  | { readonly type: "contribution"; readonly collabId: CollabId }
  | { readonly type: "rule"; readonly ruleId: RuleId; readonly period: PeriodKey }
  | { readonly type: "quest"; readonly submissionId: SubmissionId }
  | { readonly type: "admin"; readonly reason: string } // actor is on the command log
  | { readonly type: "milestone"; readonly milestone: "birthday" | "anniversary"; readonly year: number }
  | { readonly type: "import"; readonly source: "heytaco" };

interface EntryBase {
  readonly seq: bigint; // assigned by the store, total order
  readonly workspaceId: WorkspaceId;
  readonly commandKey: CommandKey; // with `ordinal` this is the entry's unique key
  readonly ordinal: number;
  readonly memberId: MemberId; // whose redeemable moves
  readonly amount: PosInt; // magnitude; the sign is fixed by `kind` (see SIGN)
  readonly at: Instant;
  readonly reason: string | null;
}

/**
 * The closed set of entry kinds. One row per (member, effect).
 * A gift row is the receiver's credit AND the giver's debit-of-allowance; the giver is `counterpartId`.
 */
export type LedgerEntry =
  | (EntryBase & {
      readonly kind: "gift";
      readonly counterpartId: MemberId; // giver
      readonly cause: { readonly type: "gift"; readonly giftId: GiftId } | { readonly type: "import"; readonly source: "heytaco" };
      readonly source: "message" | "reaction" | "sticker";
      /** Local day whose allowance this consumes; null = consumes none (stickers S74, import). */
      readonly allowanceDay: LocalDate | null;
    })
  | (EntryBase & {
      readonly kind: "gift_reversal";
      readonly counterpartId: MemberId; // giver of the reversed gift
      readonly cause: { readonly type: "gift"; readonly giftId: GiftId };
      readonly why: "reaction_removed" | "message_deleted" | "edit_decrease" | "admin";
      /** Day whose allowance is given back; null when not restored (S38 admin reversal, or the day passed). */
      readonly allowanceDay: LocalDate | null;
    })
  | (EntryBase & { readonly kind: "bonus"; readonly cause: Extract<Cause, { type: "admin" | "milestone" | "import" }> }) // S36, S94
  | (EntryBase & { readonly kind: "rule_award"; readonly cause: Extract<Cause, { type: "rule" }> }) // S63
  | (EntryBase & { readonly kind: "quest_reward"; readonly cause: Extract<Cause, { type: "quest" }> }) // S67
  | (EntryBase & { readonly kind: "spend"; readonly cause: Extract<Cause, { type: "redemption" | "contribution" }> }) // S50, S56
  | (EntryBase & { readonly kind: "refund"; readonly cause: Extract<Cause, { type: "redemption" | "contribution" }> }) // S51, S58
  | (EntryBase & { readonly kind: "deduction"; readonly cause: Extract<Cause, { type: "admin" }> }); // S37, S39

export type EntryKind = LedgerEntry["kind"];
export const SIGN: Readonly<Record<EntryKind, 1 | -1>> = {
  gift: 1, gift_reversal: -1, bonus: 1, rule_award: 1, quest_reward: 1, refund: 1, spend: -1, deduction: -1,
};
/** An entry before the store assigns seq/ordinal. */
export type NewEntry = LedgerEntry extends infer E ? (E extends LedgerEntry ? Omit<E, "seq" | "ordinal" | "commandKey" | "workspaceId"> : never) : never;

/**
 * Derived balances. Never stored as truth (S34, S78). Definitions:
 *   received(m)   = Σ signed(amount)  where kind ∈ {gift, gift_reversal} and memberId = m          (S31)
 *   given(m)      = Σ signed(amount)  where kind ∈ {gift, gift_reversal} and counterpartId = m     (S33)
 *   redeemable(m) = Σ signed(amount)  where memberId = m   — every kind moves redeemable           (S32)
 *   usedToday(m)  = Σ signed(amount)  where counterpartId = m and allowanceDay = today              (S19, S21)
 *   allowance(m)  = dailyLimit(m) − usedToday(m)                                                    (S25–S27)
 */
export interface Balances {
  readonly received: number;
  readonly given: number;
  readonly redeemable: number;
}
export declare function replay(entries: Iterable<LedgerEntry>): ReadonlyMap<MemberId, Balances>;

// ───────────────────────── Gifts ─────────────────────────
/** Platform-neutral message, already normalized by the adapter (S106). */
export interface InboundMessage {
  readonly platform: "slack" | "teams";
  readonly channel: { readonly id: string; readonly kind: "public" | "private" | "dm" };
  readonly author: Actor;
  readonly text: string;
  readonly mentions: readonly Mention[];
  readonly emojiTokens: readonly string[]; // shortcodes in order, e.g. [":taco:", ":taco:", ":fire:"]
  readonly hashtags: readonly string[];
  readonly at: Instant;
}
export type Mention =
  | { readonly kind: "member"; readonly memberId: MemberId }
  | { readonly kind: "group"; readonly groupId: string; readonly memberIds: readonly MemberId[] } // adapter expands, domain decides (S12)
  | { readonly kind: "bot" }; // S8: dropped

export interface GiftQuote { // pure result of parsing a message (S9–S12, S15)
  readonly receivers: readonly MemberId[]; // deduped, giver excluded, active only
  readonly perReceiver: PosInt;
  readonly totalCost: PosInt; // perReceiver × receivers.length (S10)
  readonly values: readonly ValueId[];
}
export declare function quoteGift(msg: InboundMessage, giver: MemberId, ctx: {
  settings: WorkspaceSettings; values: readonly Value[]; isActive: (m: MemberId) => boolean;
}): GiftQuote | null; // null = not a gift (no emoji, no receivers, DM, ...)

export interface Value { readonly id: ValueId; readonly name: string; readonly hashtag: string | null; readonly emoji: string | null } // S41

// ───────────────────────── Redemptions ─────────────────────────
/** State-specific fields only exist in their state (S49). */
export type Redemption = {
  readonly id: RedemptionId;
  readonly memberId: MemberId;
  readonly rewardId: RewardId;
  readonly variantId: VariantId | null;
  readonly cost: PosInt;
  readonly internalCost: Money | null;
  readonly createdAt: Instant;
  readonly onBehalfOf: "self" | { readonly admin: MemberId } | { readonly collab: CollabId }; // S55, S57
} & (
  | { readonly state: "pending" }
  | { readonly state: "approved"; readonly approvedAt: Instant; readonly by: Actor }
  | { readonly state: "fulfilled"; readonly approvedAt: Instant; readonly fulfilledAt: Instant; readonly by: Actor }
  | { readonly state: "rejected"; readonly rejectedAt: Instant; readonly by: Actor; readonly reason: string }
  | { readonly state: "cancelled"; readonly cancelledAt: Instant; readonly by: Actor; readonly reason: string }
);
export type RedemptionState = Redemption["state"];
/** The only legal edges. Rejection/cancellation imply a refund in the same transaction (S51). */
export const REDEMPTION_EDGES = {
  pending: ["approved", "rejected"],
  approved: ["fulfilled", "cancelled"],
  fulfilled: [],
  rejected: [],
  cancelled: [],
} as const satisfies Record<RedemptionState, readonly RedemptionState[]>;
export type RedemptionTransition = "approve" | "reject" | "cancel" | "fulfil";

// ───────────────────────── Commands ─────────────────────────
interface CommandBase { readonly key: CommandKey; readonly workspaceId: WorkspaceId; readonly actor: Actor; readonly at: Instant }

export type Command =
  | (CommandBase & { readonly type: "GiveByMessage"; readonly message: InboundMessage; readonly messageRef: string })
  | (CommandBase & { readonly type: "GiveByReaction"; readonly messageRef: string; readonly emoji: string })
  | (CommandBase & { readonly type: "RemoveReaction"; readonly messageRef: string; readonly emoji: string })
  | (CommandBase & { readonly type: "EditMessage"; readonly messageRef: string; readonly message: InboundMessage })
  | (CommandBase & { readonly type: "DeleteMessage"; readonly messageRef: string })
  | (CommandBase & { readonly type: "GiveSticker"; readonly stickerId: StickerId; readonly receivers: readonly MemberId[]; readonly channelId: string })
  | (CommandBase & { readonly type: "GrantBonus"; readonly memberIds: readonly MemberId[]; readonly amount: PosInt; readonly reason: string })
  | (CommandBase & { readonly type: "Deduct"; readonly memberId: MemberId; readonly amount: PosInt; readonly reason: string })
  | (CommandBase & { readonly type: "ReverseGift"; readonly giftId: GiftId; readonly reason: string })
  | (CommandBase & { readonly type: "ResetAllRedeemable"; readonly reason: string })
  | (CommandBase & { readonly type: "Redeem"; readonly memberId: MemberId; readonly rewardId: RewardId; readonly variantId: VariantId | null })
  | (CommandBase & { readonly type: "TransitionRedemption"; readonly redemptionId: RedemptionId; readonly transition: RedemptionTransition; readonly reason?: string })
  | (CommandBase & { readonly type: "Contribute"; readonly collabId: CollabId; readonly memberId: MemberId; readonly amount: PosInt })
  | (CommandBase & { readonly type: "EvaluateRule"; readonly ruleId: RuleId; readonly period: PeriodKey })
  | (CommandBase & { readonly type: "SubmitQuest"; readonly questId: QuestId; readonly submitter: MemberId; readonly nominee: MemberId | null; readonly proof: string | null })
  | (CommandBase & { readonly type: "ReviewSubmission"; readonly submissionId: SubmissionId; readonly decision: "approve" | "reject"; readonly amount?: PosInt })
  | (CommandBase & { readonly type: "ImportHeyTacoRow"; readonly row: HeyTacoRow });

export type HeyTacoRow =
  | { readonly kind: "gift"; readonly receiver: MemberId; readonly giver: MemberId; readonly amount: PosInt; readonly source: "message" | "reaction" | "sticker"; readonly at: Instant; readonly channel: string; readonly text: string; readonly tags: readonly string[] }
  | { readonly kind: "redemption"; readonly memberId: MemberId; readonly amount: PosInt; readonly title: string; readonly fulfilled: boolean; readonly at: Instant }
  | { readonly kind: "bonus"; readonly memberId: MemberId; readonly amount: PosInt };

export type DomainError =
  | { readonly code: "over_allowance"; readonly cost: PosInt; readonly remaining: number } // S13
  | { readonly code: "insufficient_redeemable"; readonly redeemable: number; readonly cost: PosInt } // S50
  | { readonly code: "out_of_stock" } // S46
  | { readonly code: "budget_exceeded"; readonly remaining: Money } // S47
  | { readonly code: "prepaid_insufficient" } // S108
  | { readonly code: "reward_not_active" } // S45
  | { readonly code: "illegal_transition"; readonly from: RedemptionState; readonly transition: RedemptionTransition }
  | { readonly code: "forbidden"; readonly need: Role | ApiScope }
  | { readonly code: "not_a_gift" } // silently ignored by adapters
  | { readonly code: "channel_not_allowed" } // S16
  | { readonly code: "inactive_member" } // S7
  | { readonly code: "quest_closed" | "cooldown" | "cap_reached" }
  | { readonly code: "idempotency_key_reused"; readonly originalRequestHash: string }; // S100

export type Result<T> = { readonly ok: true; readonly value: T; readonly replayed: boolean } | { readonly ok: false; readonly error: DomainError; readonly replayed: boolean };

/** What a pure `decide` returns. The shell persists all of it atomically or nothing. */
export interface Decision<T> {
  readonly result: Result<T>;
  readonly entries: readonly NewEntry[];
  readonly events: readonly DomainEvent[];
  readonly writes: readonly StateWrite[]; // non-ledger rows: gift header, redemption state, stock, tags…
}
export type StateWrite =
  | { readonly t: "gift.upsert"; readonly gift: Gift }
  | { readonly t: "redemption.insert"; readonly redemption: Redemption }
  | { readonly t: "redemption.cas"; readonly id: RedemptionId; readonly from: RedemptionState; readonly to: Redemption }
  | { readonly t: "stock.take"; readonly variant: VariantId | RewardId } // conditional decrement, fails the tx if 0
  | { readonly t: "stock.release"; readonly variant: VariantId | RewardId }
  | { readonly t: "submission.cas"; readonly id: SubmissionId; readonly from: "pending"; readonly to: "approved" | "rejected" }
  | { readonly t: "gift.tag"; readonly giftId: GiftId; readonly valueId: ValueId };

export interface Gift {
  readonly id: GiftId;
  readonly giver: MemberId;
  readonly messageRef: string | null;
  readonly channelId: string;
  readonly isPrivate: boolean; // S69
  readonly text: string | null; // null when storeMessageText is off (S70)
  readonly source: "message" | "reaction" | "sticker";
  readonly stickerId: StickerId | null;
  readonly createdAt: Instant;
}

// ───────────────────────── Events (outbox) ─────────────────────────
export type DomainEvent =
  | { readonly type: "gift.given"; readonly giftId: GiftId; readonly giver: MemberId; readonly receivers: readonly MemberId[]; readonly perReceiver: PosInt; readonly remainingAllowance: number | null }
  | { readonly type: "gift.rejected"; readonly giver: MemberId; readonly error: DomainError } // S13 private notice
  | { readonly type: "gift.reversed"; readonly giftId: GiftId; readonly amount: PosInt; readonly why: string }
  | { readonly type: `redemption.${"created" | "approved" | "rejected" | "cancelled" | "fulfilled"}`; readonly redemptionId: RedemptionId; readonly memberId: MemberId } // S54
  | { readonly type: "adjustment.made"; readonly kind: "bonus" | "deduction" | "reversal" | "reset"; readonly memberIds: readonly MemberId[]; readonly amount: number; readonly reason: string } // S40
  | { readonly type: "collab.progress" | "collab.completed" | "collab.refunded"; readonly collabId: CollabId }
  | { readonly type: "rule.awarded"; readonly ruleId: RuleId; readonly period: PeriodKey; readonly winners: readonly MemberId[]; readonly amount: PosInt } // S61, S99
  | { readonly type: `quest.submission.${"created" | "approved" | "rejected"}`; readonly submissionId: SubmissionId }
  | { readonly type: `member.${"created" | "updated" | "deactivated"}`; readonly memberId: MemberId };

// ───────────────────────── Ports ─────────────────────────
/** Lock keys are taken in sorted order; the in-memory fake uses a mutex map, Postgres uses pg_advisory_xact_lock. */
export type LockKey =
  | `member:${MemberId}`
  | `collab:${CollabId}`
  | `budget:${WorkspaceId}:${string}` // yyyy-mm
  | `prepaid:${WorkspaceId}`;

/** Everything a use case can read or write inside one atomic unit. */
export interface Tx {
  /** Returns the stored result if this command key was already committed (S17/S62/S100/S105). */
  priorResult(key: CommandKey): Promise<{ result: Result<unknown>; requestHash: string } | null>;
  balances(member: MemberId): Promise<Balances>;
  allowanceUsed(member: MemberId, day: LocalDate): Promise<number>;
  netGiftedPerReceiver(gift: GiftId): Promise<ReadonlyMap<MemberId, { net: number; allowanceDay: LocalDate | null }>>;
  giftByMessage(messageRef: string): Promise<Gift | null>;
  redemption(id: RedemptionId): Promise<Redemption | null>;
  monthSpend(month: string): Promise<Money>;
  /** Persists the decision + command log row; throws ConflictError on a failed CAS/stock take (rolls back). */
  commit<T>(key: CommandKey, requestHash: string, actor: Actor, d: Decision<T>): Promise<void>;
}
export interface UnitOfWork {
  run<T>(ws: WorkspaceId, locks: readonly LockKey[], fn: (tx: Tx) => Promise<T>): Promise<T>;
}
export interface Clock { now(): Instant }
export interface Ids { next<T extends string>(): Brand<string, T> } // uuidv7
export interface Directory { // read-only config & people, cached by adapters
  settings(ws: WorkspaceId): Promise<WorkspaceSettings>;
  dailyLimit(ws: WorkspaceId, m: MemberId): Promise<PosInt>; // override ?? role default (S25, S26)
  isActive(ws: WorkspaceId, m: MemberId): Promise<boolean>;
  values(ws: WorkspaceId): Promise<readonly Value[]>;
}
export interface GiftCardProvider { prepaidBalance(ws: WorkspaceId): Promise<Money>; fulfil(r: RedemptionId): Promise<"ok" | "insufficient"> } // S108
export interface Summarizer { digest(input: { quotes: readonly { giftId: GiftId; text: string }[]; values: readonly string[] }): Promise<string> } // S91

// ───────────────────────── Public API of @recog/core ─────────────────────────
export interface Ports { uow: UnitOfWork; clock: Clock; ids: Ids; directory: Directory; giftCards?: GiftCardProvider }
export interface Core {
  execute<C extends Command>(cmd: C): Promise<Result<unknown>>; // single entrypoint for every write
  // queries (read-only, no locks)
  balances(ws: WorkspaceId, m: MemberId): Promise<Balances & { allowanceLeft: number; level: Level }>;
  leaderboard(ws: WorkspaceId, q: LeaderboardQuery, viewer: Actor): Promise<readonly LeaderboardRow[]>;
}
export declare function createCore(ports: Ports): Core;

export interface Level { readonly number: number; readonly title: string } // S77: derived from received + given
export interface LeaderboardQuery {
  readonly board: "received" | "given" | "combined"; // S80
  readonly range: { readonly from: LocalDate; readonly to: LocalDate } | "today" | "week" | "month" | "year" | "all";
  readonly channelId?: string;
  readonly valueId?: ValueId; // S82
}
export interface LeaderboardRow { readonly memberId: MemberId; readonly total: number; readonly rank: number }
