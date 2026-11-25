// S69, S87: the public gift feed and member profiles. Private-channel gifts stay out unless shown.
import type { GiftId, Instant, MemberId, ValueId } from "../shared/types.ts";
import { isPubliclyVisible } from "../privacy/visibility.ts";
import { cmp, netByGift } from "./facts.ts";
import type { BoardData } from "./source.ts";

export interface FeedItem {
  readonly giftId: GiftId;
  readonly giver: MemberId;
  readonly receivers: readonly { readonly memberId: MemberId; readonly units: number }[];
  readonly units: number;
  readonly channelId: string;
  readonly text: string | null;
  readonly valueIds: readonly ValueId[];
  readonly at: Instant;
}

export interface FeedOptions {
  readonly limit?: number;
  /** A profile: only gifts this member gave or received. */
  readonly member?: MemberId;
}

/** Newest first. Gifts fully reversed are left out. */
export function feed(data: BoardData, opts: FeedOptions): FeedItem[] {
  const net = netByGift(data.entries);
  const items: FeedItem[] = [];
  for (const g of data.gifts) {
    if (!isPubliclyVisible(g, data.insights)) continue;
    const receivers = [...(net.get(g.id) ?? new Map<MemberId, number>())]
      .filter(([, units]) => units > 0)
      .map(([memberId, units]) => ({ memberId, units }))
      .sort((a, b) => cmp(a.memberId, b.memberId));
    if (receivers.length === 0) continue;
    if (opts.member !== undefined && g.giver !== opts.member && !receivers.some((r) => r.memberId === opts.member)) continue;
    items.push({
      giftId: g.id,
      giver: g.giver,
      receivers,
      units: receivers.reduce((t, r) => t + r.units, 0),
      channelId: g.channelId,
      text: g.text,
      valueIds: g.valueIds,
      at: g.createdAt,
    });
  }
  items.sort((a, b) => b.at - a.at || cmp(b.giftId, a.giftId));
  return opts.limit === undefined ? items : items.slice(0, opts.limit);
}
