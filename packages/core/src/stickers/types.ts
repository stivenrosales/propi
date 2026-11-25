// S73-S76: stickers, an optional module (OFF by default) with a plain monthly quota.
import type { Channel, GivingEvent, GivingWrite, GiftReceipt, Mention } from "../giving/types.ts";
import type { CommandBase, GiftId, MemberId, PosInt, WorkspaceId } from "../shared/types.ts";

export interface StickerDef {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
  /** Max receivers, or the whole channel. */
  readonly receivers: PosInt | "channel";
  readonly unitsPerReceiver: PosInt;
  /** S75: uses per member per calendar month (workspace timezone). */
  readonly monthlyQuota: PosInt;
  readonly active: boolean;
}

export type StickerInput = Omit<StickerDef, "monthlyQuota" | "active"> & { readonly monthlyQuota?: PosInt; readonly active?: boolean };

export interface StickerConfig {
  readonly enabled: boolean;
}

/** S76: extra uses for one member, sticker and month ("YYYY-MM"). */
export interface StickerGrant {
  readonly memberId: MemberId;
  readonly stickerId: string;
  readonly month: string;
  readonly uses: PosInt;
}

/** One sticker gift counted against the giver's quota for `month`. */
export interface StickerUse {
  readonly giftId: GiftId;
  readonly stickerId: string;
  readonly giver: MemberId;
  readonly month: string;
}

// ───────────── Commands ─────────────

export interface ConfigureStickers extends CommandBase {
  readonly type: "ConfigureStickers";
  readonly enabled: boolean;
}
export interface DefineSticker extends CommandBase {
  readonly type: "DefineSticker";
  readonly sticker: StickerInput;
}
export interface GrantStickerUses extends CommandBase {
  readonly type: "GrantStickerUses";
  readonly memberId: MemberId;
  readonly stickerId: string;
  readonly uses: PosInt;
}
export interface GiveSticker extends CommandBase {
  readonly type: "GiveSticker";
  readonly messageRef: string;
  readonly stickerId: string;
  readonly channel: Channel;
  /** Resolved by the adapter, as for message gifts. */
  readonly mentions: readonly Mention[];
  /** For whole-channel stickers: the channel's members, resolved by the adapter. */
  readonly channelMembers: readonly MemberId[];
}

export type StickerCommand = ConfigureStickers | DefineSticker | GrantStickerUses | GiveSticker;

export interface StickerReceipt extends GiftReceipt {
  /** Quota left this month after this gift. */
  readonly usesLeft: number;
}

// ───────────── Events and writes ─────────────

/** Sticker gifts reuse the giving event (S29 shape, remainingAllowance null). */
export type StickerEvent = Extract<GivingEvent, { type: "gift.given" }>;

export type StickerWrite =
  | GivingWrite
  | { readonly t: "sticker.config"; readonly config: StickerConfig }
  | { readonly t: "sticker.upsert"; readonly sticker: StickerDef }
  | { readonly t: "sticker.grant"; readonly grant: StickerGrant }
  | { readonly t: "sticker.used"; readonly use: StickerUse };

/** Read port for stickers (implemented by packages/db and the in-memory fake). */
export interface StickerStore {
  config(ws: WorkspaceId): Promise<StickerConfig>;
  sticker(ws: WorkspaceId, id: string): Promise<StickerDef | null>;
  stickers(ws: WorkspaceId): Promise<readonly StickerDef[]>;
  /** Extra uses granted to `member` for `sticker` in `month`. */
  granted(ws: WorkspaceId, member: MemberId, stickerId: string, month: string): Promise<number>;
  /** Sticker gifts `member` gave with `sticker` in `month`. */
  used(ws: WorkspaceId, member: MemberId, stickerId: string, month: string): Promise<number>;
}
