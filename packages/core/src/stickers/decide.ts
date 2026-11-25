// S73-S76: pure sticker deciders. Sticker gifts are ordinary gift entries with source "sticker";
// the giving hook (allowanceDayFor / consumesAllowance) makes them skip the allowance (S74).
import { allowanceDayFor } from "../giving/allowance.ts";
import { channelAllowed, receiversOf } from "../giving/quote.ts";
import type { Gift, Mention } from "../giving/types.ts";
import type { NewEntry } from "../ledger/entries.ts";
import type { MemberRecord } from "../members/members.ts";
import { fail, isAdminOrSystem, ok, type ModuleDecision } from "../rules/module-decision.ts";
import type { GiftId, Instant, MemberId, PosInt } from "../shared/types.ts";
import { isPosInt } from "../shared/types.ts";
import type { WorkspaceSettings } from "../workspace/settings.ts";
import { localMonth } from "../workspace/time.ts";
import type {
  ConfigureStickers,
  DefineSticker,
  GiveSticker,
  GrantStickerUses,
  StickerConfig,
  StickerDef,
  StickerEvent,
  StickerReceipt,
  StickerWrite,
} from "./types.ts";

export type StickerDecision<T> = ModuleDecision<T, StickerEvent, StickerWrite>;

/** S73: the module is OFF by default. */
export const STICKERS_OFF: StickerConfig = { enabled: false };

const preset = (id: string, name: string, receivers: number | "channel", units: number): StickerDef => ({
  id,
  name,
  image: null,
  receivers: receivers === "channel" ? "channel" : (receivers as PosInt),
  unitsPerReceiver: units as PosInt,
  monthlyQuota: 1 as PosInt,
  active: true,
});

/** S73: Pearson's current HeyTaco set, ready to preload. */
export const STICKER_PRESET: readonly StickerDef[] = [
  preset("confetti", "Confetti", "channel", 1),
  preset("high-five", "High Five", 3, 1),
  preset("pinata", "Piñata", 6, 1),
  preset("trophy", "Trophy", 1, 5),
  preset("truck", "Truck", 5, 2),
  preset("rain", "Rain", 10, 1),
  preset("rockstars", "Rockstars", 5, 1),
  preset("tacocat", "Tacocat", 1, 2),
];

/** S73: an admin turns the module on or off. */
export function decideConfigureStickers(cmd: ConfigureStickers, _now: Instant): StickerDecision<StickerConfig> {
  if (!isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  const config: StickerConfig = { enabled: cmd.enabled };
  return ok(config, { writes: [{ t: "sticker.config", config }] });
}

/** S73: an admin defines (or replaces) a sticker. */
export function decideDefineSticker(cmd: DefineSticker, _now: Instant): StickerDecision<{ stickerId: string }> {
  if (!isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  const s = cmd.sticker;
  if (s.id.trim() === "") return fail({ code: "invalid_field", field: "id" });
  if (s.name.trim() === "") return fail({ code: "invalid_field", field: "name" });
  if (s.receivers !== "channel" && !isPosInt(s.receivers)) return fail({ code: "invalid_field", field: "receivers" });
  if (!isPosInt(s.unitsPerReceiver)) return fail({ code: "invalid_field", field: "unitsPerReceiver" });
  if (s.monthlyQuota !== undefined && !isPosInt(s.monthlyQuota)) return fail({ code: "invalid_field", field: "monthlyQuota" });
  const sticker: StickerDef = { ...s, monthlyQuota: s.monthlyQuota ?? (1 as PosInt), active: s.active ?? true };
  return ok({ stickerId: sticker.id }, { writes: [{ t: "sticker.upsert", sticker }] });
}

export interface GrantSnapshot {
  readonly settings: WorkspaceSettings;
  readonly sticker: StickerDef | null;
  readonly member: MemberRecord | null;
}

/** S76: extra uses for the current month in the workspace timezone. */
export function decideGrantStickerUses(s: GrantSnapshot, cmd: GrantStickerUses, now: Instant): StickerDecision<{ month: string; uses: number }> {
  if (!isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  if (!isPosInt(cmd.uses)) return fail({ code: "invalid_field", field: "uses" });
  if (s.sticker === null) return fail({ code: "not_found", what: "sticker" });
  if (s.member === null) return fail({ code: "not_found", what: "member" });
  const month = localMonth(now, s.settings.timezone);
  return ok({ month, uses: cmd.uses }, { writes: [{ t: "sticker.grant", grant: { memberId: cmd.memberId, stickerId: cmd.stickerId, month, uses: cmd.uses } }] });
}

export interface GiveStickerSnapshot {
  readonly settings: WorkspaceSettings;
  readonly config: StickerConfig;
  readonly sticker: StickerDef | null;
  readonly giverRecord: MemberRecord | null;
  /** Which candidate receivers are active members (S7). */
  readonly activeMembers: ReadonlySet<MemberId>;
  /** The giver's uses of this sticker in the current month (S75). */
  readonly used: number;
  /** Extra uses granted for the current month (S76). */
  readonly granted: number;
  readonly newGiftId: GiftId;
}

/** S73-S75: give a sticker. No allowance is consumed; the monthly quota is. */
export function decideGiveSticker(s: GiveStickerSnapshot, cmd: GiveSticker, now: Instant): StickerDecision<StickerReceipt> {
  if (!s.config.enabled) return fail({ code: "module_disabled" });
  if (cmd.actor.kind !== "member") return fail({ code: "forbidden", need: "member" });
  const giver = s.giverRecord;
  if (giver === null) return fail({ code: "not_found", what: "member" });
  if (!giver.active) return fail({ code: "inactive_member" });
  const sticker = s.sticker;
  if (sticker === null || !sticker.active) return fail({ code: "not_found", what: "sticker" });

  const ctx = { settings: { ...s.settings, groupMentionsEnabled: true }, values: [], activeMembers: s.activeMembers };
  const targets: readonly Mention[] =
    sticker.receivers === "channel"
      ? [{ kind: "group", groupId: cmd.channel.id, memberIds: cmd.channelMembers }]
      : cmd.mentions.filter((mn) => mn.kind !== "group" || s.settings.groupMentionsEnabled);
  const receivers = receiversOf(targets, giver.id, ctx);
  if (receivers.length === 0) return fail({ code: "not_a_gift" });
  if (sticker.receivers !== "channel" && receivers.length > sticker.receivers) return fail({ code: "too_many_receivers", max: sticker.receivers });
  if (!channelAllowed(cmd.channel, s.settings)) return fail({ code: "channel_not_allowed" });

  const available = sticker.monthlyQuota + s.granted;
  if (s.used >= available) return fail({ code: "quota_exhausted", used: s.used, available });

  const day = allowanceDayFor("sticker", now, s.settings.timezone); // S74: null, the giving hook
  const month = localMonth(now, s.settings.timezone);
  const gift: Gift = {
    id: s.newGiftId,
    giver: giver.id,
    messageRef: cmd.messageRef,
    source: "sticker",
    emoji: null,
    channelId: cmd.channel.id,
    isPrivate: cmd.channel.kind !== "public",
    text: s.settings.storeMessageText ? sticker.name : null,
    valueIds: [],
    allowanceDay: day,
    createdAt: now,
    closedBy: null,
  };
  const entries: NewEntry[] = receivers.map((memberId) => ({
    kind: "gift",
    amount: sticker.unitsPerReceiver,
    memberId,
    counterpartId: giver.id,
    cause: { type: "gift", giftId: gift.id },
    source: "sticker",
    allowanceDay: day,
    reason: gift.text,
  }));
  const receipt: StickerReceipt = {
    giftId: gift.id,
    receivers,
    perReceiver: sticker.unitsPerReceiver,
    totalCost: sticker.unitsPerReceiver * receivers.length,
    remainingAllowance: null,
    usesLeft: available - s.used - 1,
  };
  const { usesLeft: _usesLeft, ...given } = receipt;
  return ok(receipt, {
    entries,
    writes: [
      { t: "gift.upsert", gift },
      { t: "sticker.used", use: { giftId: gift.id, stickerId: sticker.id, giver: giver.id, month } },
    ],
    events: [{ type: "gift.given", giver: giver.id, source: "sticker", ...given }],
  });
}
