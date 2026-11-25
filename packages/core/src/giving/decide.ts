// S9-S29: pure giving deciders, (snapshot, command, now) -> Decision.
import { accept, reject, type Decision, type DomainEvent } from "../shared/decision.ts";
import type { Actor, CommandKey, GiftId, Instant, LocalDate, MemberId, PosInt, ValueId } from "../shared/types.ts";
import { isPosInt } from "../shared/types.ts";
import type { GiftSource, NewEntry } from "../ledger/entries.ts";
import { resolveGiver, type Giver, type MemberRecord } from "../members/members.ts";
import type { Value } from "../values/values.ts";
import { giftEmojiValues } from "../workspace/currency.ts";
import type { WorkspaceSettings } from "../workspace/settings.ts";
import { localDate } from "../workspace/time.ts";
import { allowanceDayFor, dailyLimit, remainingAllowance } from "./allowance.ts";
import { channelAllowed, quoteGift, receiversOf, type GiftQuote } from "./quote.ts";
import type {
  Channel,
  DeleteMessage,
  EditMessage,
  EditReceipt,
  Gift,
  GiftReceipt,
  GiveByMessage,
  GiveByReaction,
  GivingWrite,
  RemoveReaction,
  ReversalReceipt,
  ReversalWhy,
} from "./types.ts";

/** What every giving decider needs about the giver and the candidate receivers. */
export interface GiveSnapshot {
  readonly settings: WorkspaceSettings;
  /** The giver's member record; null for bots and unknown people. */
  readonly giverRecord: MemberRecord | null;
  readonly activeMembers: ReadonlySet<MemberId>;
  readonly values: readonly Value[];
  /** Units the giver already used today (S19, S27). */
  readonly allowanceUsed: number;
  /** Pre-allocated id in case a new gift is created (deciders are pure). */
  readonly newGiftId: GiftId;
}

export interface ReactionSnapshot extends GiveSnapshot {
  /** S20: this giver already holds an active reaction gift on this (message, emoji). */
  readonly alreadyGifted: boolean;
  /** S38: an admin reversed this giver's reaction gift on this (message, emoji); it is final. */
  readonly closedByAdmin: boolean;
}

export interface ReversalSnapshot {
  readonly settings: WorkspaceSettings;
  readonly gift: Gift | null;
  /** Net units each receiver still holds from the gift. */
  readonly net: ReadonlyMap<MemberId, number>;
}

export interface EditSnapshot extends GiveSnapshot {
  readonly gift: Gift | null;
  readonly net: ReadonlyMap<MemberId, number>;
}

/** G8: the reaction key carries an occurrence counter = prior same-day reversals of that reaction. */
export const reactionKey = (base: CommandKey, occurrence: number): CommandKey => `${base}:${occurrence}` as CommandKey;

/** The id the giver has in the ledger, before checking whether they may give. */
export function giverIdOf(actor: Actor): MemberId | null {
  if (actor.kind === "member") return actor.memberId;
  if (actor.kind === "bot") return `bot:${actor.platformUserId}` as MemberId;
  return null;
}

interface Draft {
  readonly source: GiftSource;
  readonly messageRef: string;
  readonly emoji: string | null;
  readonly channel: Channel;
  readonly text: string | null;
  readonly quote: GiftQuote;
}

function giveNew(s: GiveSnapshot, actor: Actor, draft: Draft, now: Instant): Decision<GiftReceipt> {
  const resolved = resolveGiver(actor, s.giverRecord, s.settings);
  if (!resolved.ok) return reject(resolved.error);
  const giver = resolved.giver;
  const { quote } = draft;
  const day = allowanceDayFor(draft.source, now, s.settings.timezone);
  let remaining: number | null = null;
  if (day !== null) {
    const left = remainingAllowance(dailyLimit(giver, s.settings), s.allowanceUsed);
    if (quote.totalCost > left) {
      const error = { code: "over_allowance", cost: quote.totalCost, remaining: left } as const;
      return reject(error, [{ type: "gift.rejected", giver: giver.id, error }]);
    }
    remaining = left - quote.totalCost;
  }
  const text = s.settings.storeMessageText ? draft.text : null;
  const gift: Gift = {
    id: s.newGiftId,
    giver: giver.id,
    messageRef: draft.messageRef,
    source: draft.source,
    emoji: draft.emoji,
    channelId: draft.channel.id,
    isPrivate: draft.channel.kind !== "public",
    text,
    valueIds: quote.valueIds,
    allowanceDay: day,
    createdAt: now,
    closedBy: null,
  };
  const entries: NewEntry[] = quote.receivers.map((memberId) => ({
    kind: "gift",
    amount: quote.perReceiver as PosInt,
    memberId,
    counterpartId: giver.id,
    cause: { type: "gift", giftId: gift.id },
    source: draft.source,
    allowanceDay: day,
    reason: text,
  }));
  const receipt: GiftReceipt = {
    giftId: gift.id,
    receivers: quote.receivers,
    perReceiver: quote.perReceiver,
    totalCost: quote.totalCost,
    remainingAllowance: remaining,
  };
  return accept(receipt, {
    entries,
    writes: [{ t: "gift.upsert", gift }],
    events: [{ type: "gift.given", giver: giver.id, source: draft.source, ...receipt }],
  });
}

/** S9-S16, S19, S25-S29: a gift by message. */
export function decideGiveByMessage(s: GiveSnapshot, cmd: GiveByMessage, now: Instant): Decision<GiftReceipt> {
  const giverId = giverIdOf(cmd.actor);
  if (giverId === null) return reject({ code: "forbidden", need: "member" });
  const q = quoteGift(cmd.message, giverId, s);
  if (!q.ok) return reject(q.error);
  return giveNew(s, cmd.actor, { source: "message", messageRef: cmd.messageRef, emoji: null, channel: cmd.message.channel, text: cmd.message.text, quote: q.quote }, now);
}

/** S18-S20, S22: a gift by reaction. */
export function decideGiveByReaction(s: ReactionSnapshot, cmd: GiveByReaction, now: Instant): Decision<GiftReceipt> {
  const giverId = giverIdOf(cmd.actor);
  if (giverId === null) return reject({ code: "forbidden", need: "member" });
  const perReceiver = giftEmojiValues(s.settings.currency).get(cmd.emoji) ?? 0;
  if (!s.settings.reactionsEnabled || perReceiver === 0 || s.alreadyGifted) return reject({ code: "not_a_gift" });
  if (s.closedByAdmin) return reject({ code: "gift_closed" });
  const people = cmd.target.mentions.filter((mn) => mn.kind !== "bot");
  const targets = people.length > 0 ? people : cmd.target.author !== null ? [{ kind: "member", memberId: cmd.target.author } as const] : [];
  const receivers = receiversOf(targets, giverId, s);
  if (receivers.length === 0) return reject({ code: "not_a_gift" });
  if (!channelAllowed(cmd.channel, s.settings)) return reject({ code: "channel_not_allowed" });
  const quote: GiftQuote = { receivers, perReceiver, totalCost: perReceiver * receivers.length, valueIds: [] };
  return giveNew(s, cmd.actor, { source: "reaction", messageRef: cmd.messageRef, emoji: cmd.emoji, channel: cmd.channel, text: null, quote }, now);
}

function reverseAll(s: ReversalSnapshot, why: ReversalWhy, now: Instant): Decision<ReversalReceipt> {
  const gift = s.gift;
  if (gift === null) return accept({ giftId: null, reversed: 0, allowanceRestored: 0 });
  const today = localDate(now, s.settings.timezone);
  // S21, S24: only on the gift's own allowance day; after that the gift stands.
  if (gift.allowanceDay !== today) return accept({ giftId: gift.id, reversed: 0, allowanceRestored: 0 });
  const entries = reversalEntries(gift, s.net, why, today);
  const reversed = entries.reduce((t, e) => t + e.amount, 0);
  const events: DomainEvent[] = reversed > 0 ? [{ type: "gift.reversed", giftId: gift.id, amount: reversed as PosInt, why }] : [];
  // S24: a deleted message is gone, so its gift is final; a late edit event cannot re-gift it.
  // A removed reaction stays open: re-adding it the same day is a new intent (G8).
  const writes: GivingWrite[] = why === "message_deleted" && gift.closedBy === null ? [{ t: "gift.upsert", gift: { ...gift, closedBy: "message_deleted" } }] : [];
  return accept({ giftId: gift.id, reversed, allowanceRestored: reversed }, { entries, writes, events });
}

function reversalEntries(gift: Gift, net: ReadonlyMap<MemberId, number>, why: ReversalWhy, day: LocalDate | null): NewEntry[] {
  const out: NewEntry[] = [];
  for (const [memberId, units] of net) {
    if (!isPosInt(units)) continue;
    out.push({ kind: "gift_reversal", amount: units, memberId, counterpartId: gift.giver, cause: { type: "gift", giftId: gift.id }, source: gift.source, allowanceDay: day, reason: why });
  }
  return out;
}

/** S21: removing a reaction the same allowance day reverses it and returns the allowance. */
export function decideRemoveReaction(s: ReversalSnapshot, _cmd: RemoveReaction, now: Instant): Decision<ReversalReceipt> {
  return reverseAll(s, "reaction_removed", now);
}

/** S24: deleting a gift message the same allowance day reverses its gifts. */
export function decideDeleteMessage(s: ReversalSnapshot, _cmd: DeleteMessage, now: Instant): Decision<ReversalReceipt> {
  return reverseAll(s, "message_deleted", now);
}

/** S23: recompute an edited message; apply top-ups and reversals under the allowance rules. */
export function decideEditMessage(s: EditSnapshot, cmd: EditMessage, now: Instant): Decision<EditReceipt> {
  const gift = s.gift;
  if (gift === null) {
    const d = decideGiveByMessage(s, { ...cmd, type: "GiveByMessage" }, now);
    if (!d.outcome.ok) return { ...d, outcome: d.outcome };
    const r = d.outcome.value;
    return { ...d, outcome: { ok: true, value: { giftId: r.giftId, added: r.totalCost, reversed: 0, remainingAllowance: r.remainingAllowance ?? 0 } } };
  }
  const resolved = resolveGiver(cmd.actor, s.giverRecord, s.settings);
  if (!resolved.ok) return reject(resolved.error);
  if (resolved.giver.id !== gift.giver) return reject({ code: "forbidden", need: "member" });
  // S38, S24: an admin-reversed or deleted gift is final; an edit never re-applies it.
  if (gift.closedBy !== null) return reject({ code: "gift_closed" });
  const giver: Giver = resolved.giver;

  const q = quoteGift(cmd.message, giver.id, s);
  const target = new Map<MemberId, number>(q.ok ? q.quote.receivers.map((r) => [r, q.quote.perReceiver]) : []);
  const today = localDate(now, s.settings.timezone);
  const restoresToday = gift.allowanceDay === today;
  const text = s.settings.storeMessageText ? cmd.message.text : null;

  const increases: NewEntry[] = [];
  const decreases: NewEntry[] = [];
  for (const memberId of new Set([...target.keys(), ...s.net.keys()])) {
    const diff = (target.get(memberId) ?? 0) - Math.max(0, s.net.get(memberId) ?? 0);
    const base = { memberId, counterpartId: giver.id, cause: { type: "gift", giftId: gift.id } as const, source: gift.source };
    if (diff > 0) increases.push({ ...base, kind: "gift", amount: diff as PosInt, allowanceDay: today, reason: text });
    if (diff < 0) decreases.push({ ...base, kind: "gift_reversal", amount: -diff as PosInt, allowanceDay: restoresToday ? today : null, reason: "edit_decrease" });
  }
  const added = increases.reduce((t, e) => t + e.amount, 0);
  const reversed = decreases.reduce((t, e) => t + e.amount, 0);
  const left = remainingAllowance(dailyLimit(giver, s.settings), s.allowanceUsed) + (restoresToday ? reversed : 0);
  if (added > left) {
    const error = { code: "over_allowance", cost: added, remaining: left } as const;
    return reject(error, [{ type: "gift.rejected", giver: giver.id, error }]);
  }
  const valueIds: readonly ValueId[] = q.ok ? q.quote.valueIds : [];
  const events: DomainEvent[] = [];
  if (added > 0) events.push({ type: "gift.given", giftId: gift.id, giver: giver.id, receivers: increases.map((e) => e.memberId), perReceiver: q.ok ? q.quote.perReceiver : 0, totalCost: added, remainingAllowance: left - added, source: gift.source });
  if (reversed > 0) events.push({ type: "gift.reversed", giftId: gift.id, amount: reversed as PosInt, why: "edit_decrease" });
  return accept(
    { giftId: gift.id, added, reversed, remainingAllowance: left - added },
    { entries: [...increases, ...decreases], writes: [{ t: "gift.upsert", gift: { ...gift, text, valueIds } }], events },
  );
}
