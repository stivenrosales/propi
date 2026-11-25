// S9-S12, S15, S16: what a message is worth and to whom.
import type { DomainError, MemberId, ValueId } from "../shared/types.ts";
import type { Value } from "../values/values.ts";
import { matchValues } from "../values/values.ts";
import { amountOf } from "../workspace/currency.ts";
import type { WorkspaceSettings } from "../workspace/settings.ts";
import type { Channel, InboundMessage, Mention } from "./types.ts";

export interface GiftQuote {
  readonly receivers: readonly MemberId[]; // deduped, giver excluded, active only
  readonly perReceiver: number;
  readonly totalCost: number; // perReceiver x receivers (S10)
  readonly valueIds: readonly ValueId[]; // S15
}

export interface QuoteContext {
  readonly settings: WorkspaceSettings;
  readonly values: readonly Value[];
  /** Which candidate receivers are active members (S7). Anyone absent is dropped. */
  readonly activeMembers: ReadonlySet<MemberId>;
}

export type QuoteResult = { readonly ok: true; readonly quote: GiftQuote } | { readonly ok: false; readonly error: DomainError };

/** S9-S12, S22: mentioned members plus expanded groups (if on), minus bots, the giver and inactive members. */
export function receiversOf(mentions: readonly Mention[], giver: MemberId, ctx: QuoteContext): MemberId[] {
  const out = new Set<MemberId>();
  for (const mn of mentions) {
    if (mn.kind === "member") out.add(mn.memberId);
    else if (mn.kind === "group" && ctx.settings.groupMentionsEnabled) for (const id of mn.memberIds) out.add(id);
  }
  out.delete(giver);
  return [...out].filter((id) => ctx.activeMembers.has(id));
}

/** S16: DMs never; private channels only when allowed. */
export function channelAllowed(channel: Channel, settings: WorkspaceSettings): boolean {
  if (channel.kind === "dm") return false;
  if (channel.kind === "private") return settings.privateChannelsAllowed;
  return true;
}

export function quoteGift(msg: InboundMessage, giver: MemberId, ctx: QuoteContext): QuoteResult {
  const perReceiver = amountOf(msg.emojiTokens, ctx.settings.currency);
  const receivers = receiversOf(msg.mentions, giver, ctx);
  if (perReceiver === 0 || receivers.length === 0) return { ok: false, error: { code: "not_a_gift" } };
  if (!channelAllowed(msg.channel, ctx.settings)) return { ok: false, error: { code: "channel_not_allowed" } };
  return {
    ok: true,
    quote: { receivers, perReceiver, totalCost: perReceiver * receivers.length, valueIds: matchValues(msg.hashtags, msg.emojiTokens, ctx.values) },
  };
}
