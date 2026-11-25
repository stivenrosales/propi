// S91: the monthly AI digest. Core selects the INPUT (stored gift text, grouped by value, per team
// and per member, each quote linked to its gift id) and validates the summary's links. The
// Summarizer itself is a port; core never calls a network.
import type { GiftId, MemberId, ValueId } from "../shared/types.ts";
import { localMonth } from "../workspace/time.ts";
import { cmp, netByGift } from "../boards/facts.ts";
import type { BoardData } from "../boards/source.ts";
import { isPubliclyVisible } from "../privacy/visibility.ts";

export interface DigestQuote {
  readonly giftId: GiftId;
  readonly giver: MemberId;
  readonly receivers: readonly MemberId[];
  readonly units: number;
  readonly text: string;
  readonly valueIds: readonly ValueId[];
}

/** valueId null = untagged gifts. */
export interface DigestGroup {
  readonly valueId: ValueId | null;
  readonly quotes: readonly DigestQuote[];
}

export type DigestInput =
  | { readonly enabled: false; readonly month: string; readonly reason: "message_text_off" }
  | {
      readonly enabled: true;
      readonly month: string;
      readonly team: readonly DigestGroup[];
      readonly members: readonly { readonly memberId: MemberId; readonly groups: readonly DigestGroup[] }[];
    };

export type EnabledDigestInput = Extract<DigestInput, { enabled: true }>;

export interface DigestTheme {
  readonly title: string;
  readonly summary: string;
  readonly valueId: ValueId | null;
  /** The gifts this theme quotes; each must be in the input. */
  readonly giftIds: readonly GiftId[];
}

export interface DigestSummary {
  readonly team: readonly DigestTheme[];
  readonly members: readonly { readonly memberId: MemberId; readonly themes: readonly DigestTheme[] }[];
}

/** Port: an LLM (or anything) that writes themes from the selected quotes. */
export interface Summarizer {
  summarize(input: EnabledDigestInput): Promise<DigestSummary>;
}

function groupByValue(quotes: readonly DigestQuote[], maxPerGroup: number): DigestGroup[] {
  const groups = new Map<ValueId | null, DigestQuote[]>();
  for (const q of quotes) {
    for (const v of q.valueIds.length > 0 ? q.valueIds : [null]) {
      let list = groups.get(v);
      if (!list) groups.set(v, (list = []));
      list.push(q);
    }
  }
  return [...groups]
    .map(([valueId, qs]) => ({ valueId, quotes: qs.slice(0, maxPerGroup) }))
    .sort((a, b) => (a.valueId === null ? 1 : 0) - (b.valueId === null ? 1 : 0) || b.quotes.length - a.quotes.length || cmp(a.valueId ?? "", b.valueId ?? ""));
}

/** Gifts created in `month` (workspace tz) with stored text, still held (net > 0) and publicly visible (S69). */
export function digestInput(data: BoardData, month: string, opts: { readonly maxQuotesPerGroup?: number } = {}): DigestInput {
  if (!data.workspace.storeMessageText) return { enabled: false, month, reason: "message_text_off" };
  const max = opts.maxQuotesPerGroup ?? 20;
  const net = netByGift(data.entries);
  const quotes: DigestQuote[] = [];
  for (const g of data.gifts) {
    if (g.text === null || !isPubliclyVisible(g, data.insights) || localMonth(g.createdAt, data.workspace.timezone) !== month) continue;
    const held = [...(net.get(g.id) ?? new Map<MemberId, number>())].filter(([, n]) => n > 0);
    if (held.length === 0) continue;
    quotes.push({
      giftId: g.id,
      giver: g.giver,
      receivers: held.map(([id]) => id).sort(cmp),
      units: held.reduce((t, [, n]) => t + n, 0),
      text: g.text,
      valueIds: g.valueIds,
    });
  }
  quotes.sort((a, b) => b.units - a.units || cmp(a.giftId, b.giftId));
  const receivers = [...new Set(quotes.flatMap((q) => q.receivers))].sort(cmp);
  return {
    enabled: true,
    month,
    team: groupByValue(quotes, max),
    members: receivers.map((memberId) => ({ memberId, groups: groupByValue(quotes.filter((q) => q.receivers.includes(memberId)), max) })),
  };
}

const idsOf = (groups: readonly DigestGroup[]) => new Set(groups.flatMap((g) => g.quotes.map((q) => q.giftId)));

function keepLinked(themes: readonly DigestTheme[], allowed: ReadonlySet<GiftId>): DigestTheme[] {
  return themes.map((t) => ({ ...t, giftIds: t.giftIds.filter((id) => allowed.has(id)) })).filter((t) => t.giftIds.length > 0);
}

/** Drops quotes that do not link to a gift of the input (team) or of that member's input. */
export function linkDigest(summary: DigestSummary, input: EnabledDigestInput): DigestSummary {
  const memberIds = new Map(input.members.map((m) => [m.memberId, idsOf(m.groups)]));
  return {
    team: keepLinked(summary.team, idsOf(input.team)),
    members: summary.members.flatMap((m) => {
      const allowed = memberIds.get(m.memberId);
      if (allowed === undefined) return [];
      const themes = keepLinked(m.themes, allowed);
      return themes.length === 0 ? [] : [{ memberId: m.memberId, themes }];
    }),
  };
}
