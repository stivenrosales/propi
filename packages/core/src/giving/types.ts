// Giving: normalized input, gift header, commands, events and writes (S9-S29).
import type { CommandBase, DomainError, GiftId, Instant, LocalDate, MemberId, PosInt, ValueId } from "../shared/types.ts";
import type { GiftSource } from "../ledger/entries.ts";

export type ChannelKind = "public" | "private" | "dm";
export interface Channel {
  readonly id: string;
  readonly kind: ChannelKind;
}

/** A mention, already resolved by the adapter. Groups arrive pre-expanded; the domain decides (S12). */
export type Mention =
  | { readonly kind: "member"; readonly memberId: MemberId }
  | { readonly kind: "group"; readonly groupId: string; readonly memberIds: readonly MemberId[] }
  | { readonly kind: "bot" }; // S8: dropped

/** Platform-neutral message, normalized by the adapter (S106). */
export interface InboundMessage {
  readonly channel: Channel;
  readonly text: string;
  readonly mentions: readonly Mention[];
  /** Emoji shortcodes in order, e.g. [":taco:", ":taco:", ":fire:"]. */
  readonly emojiTokens: readonly string[];
  readonly hashtags: readonly string[];
}

/**
 * Why a gift is final (S23): an admin reversed it (S38) or its message was deleted the same
 * allowance day (S24). A closed gift is never topped up again by an edit or a re-added reaction.
 */
export type GiftClosure = "admin" | "message_deleted";

/** Gift header: one row per gift (message, reaction or sticker). */
export interface Gift {
  readonly id: GiftId;
  readonly giver: MemberId;
  /** The platform message the gift is attached to (the reacted message for reactions). */
  readonly messageRef: string | null;
  readonly source: GiftSource;
  /** The reaction emoji, for reaction gifts. */
  readonly emoji: string | null;
  readonly channelId: string;
  readonly isPrivate: boolean;
  readonly text: string | null; // null when storeMessageText is off (S14, S70)
  readonly valueIds: readonly ValueId[]; // S15
  /** The local day the gift consumed; null when it consumed none (stickers, imports). */
  readonly allowanceDay: LocalDate | null;
  readonly createdAt: Instant;
  /** Set once the gift is final; null while edits may still recompute it. */
  readonly closedBy: GiftClosure | null;
}

// ───────────── Commands ─────────────

export interface GiveByMessage extends CommandBase {
  readonly type: "GiveByMessage";
  readonly messageRef: string;
  readonly message: InboundMessage;
}

export interface GiveByReaction extends CommandBase {
  readonly type: "GiveByReaction";
  readonly messageRef: string;
  readonly emoji: string;
  readonly channel: Channel;
  /** The reacted message: its author (null if a bot) and its mentions (S18). */
  readonly target: { readonly author: MemberId | null; readonly mentions: readonly Mention[] };
}

export interface RemoveReaction extends CommandBase {
  readonly type: "RemoveReaction";
  readonly messageRef: string;
  readonly emoji: string;
}

export interface EditMessage extends CommandBase {
  readonly type: "EditMessage";
  readonly messageRef: string;
  readonly message: InboundMessage;
}

export interface DeleteMessage extends CommandBase {
  readonly type: "DeleteMessage";
  readonly messageRef: string;
}

export type GivingCommand = GiveByMessage | GiveByReaction | RemoveReaction | EditMessage | DeleteMessage;

// ───────────── Results ─────────────

export interface GiftReceipt {
  readonly giftId: GiftId;
  readonly receivers: readonly MemberId[];
  readonly perReceiver: number;
  readonly totalCost: number;
  /** S29: allowance left after this gift; null when the source consumes none. */
  readonly remainingAllowance: number | null;
}

export interface ReversalReceipt {
  readonly giftId: GiftId | null;
  readonly reversed: number;
  readonly allowanceRestored: number;
}

export interface EditReceipt {
  readonly giftId: GiftId;
  readonly added: number;
  readonly reversed: number;
  readonly remainingAllowance: number;
}

// ───────────── Events and writes ─────────────

export type ReversalWhy = "reaction_removed" | "message_deleted" | "edit_decrease" | "admin";

export type GivingEvent =
  | {
      readonly type: "gift.given";
      readonly giftId: GiftId;
      readonly giver: MemberId;
      readonly receivers: readonly MemberId[];
      readonly perReceiver: number;
      readonly totalCost: number;
      readonly remainingAllowance: number | null; // S29
      readonly source: GiftSource;
    }
  | { readonly type: "gift.rejected"; readonly giver: MemberId; readonly error: DomainError } // S13 private notice
  | { readonly type: "gift.reversed"; readonly giftId: GiftId; readonly amount: PosInt; readonly why: ReversalWhy };

export type GivingWrite = { readonly t: "gift.upsert"; readonly gift: Gift };
