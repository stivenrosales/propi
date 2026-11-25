// Gift lines: one row per gift/gift_reversal entry joined with its gift header.
// SQL shape: ledger_entry LEFT JOIN gift ON cause_id = gift.id WHERE kind IN ('gift','gift_reversal').
import type { GiftSource, LedgerEntry } from "../ledger/entries.ts";
import { signedAmount } from "../ledger/entries.ts";
import type { Gift } from "../giving/types.ts";
import type { MemberRecord } from "../members/members.ts";
import type { GiftId, Instant, LocalDate, MemberId, ValueId } from "../shared/types.ts";
import { localDate } from "../workspace/time.ts";
import type { BoardData } from "./source.ts";

export interface GiftLine {
  /** The gift id, or `entry:<command key>` for header-less gifts (imports). */
  readonly giftKey: string;
  readonly giftId: GiftId | null;
  readonly giver: MemberId | null;
  readonly receiver: MemberId;
  /** Signed: positive for gifts, negative for reversals. */
  readonly units: number;
  readonly at: Instant;
  readonly day: LocalDate;
  readonly channelId: string | null;
  readonly isPrivate: boolean;
  readonly valueIds: readonly ValueId[];
  readonly source: GiftSource | null;
}

export function giftLines(data: Pick<BoardData, "entries" | "gifts" | "workspace">): GiftLine[] {
  const headers = new Map<GiftId, Gift>(data.gifts.map((g) => [g.id, g]));
  const tz = data.workspace.timezone;
  const out: GiftLine[] = [];
  for (const e of data.entries) {
    if (e.kind !== "gift" && e.kind !== "gift_reversal") continue;
    const giftId = e.cause.type === "gift" ? e.cause.giftId : null;
    const h = giftId === null ? undefined : headers.get(giftId);
    out.push({
      giftKey: giftId ?? `entry:${e.commandKey}`,
      giftId,
      giver: e.counterpartId,
      receiver: e.memberId,
      units: signedAmount(e),
      at: e.at,
      day: localDate(e.at, tz),
      channelId: h?.channelId ?? null,
      isPrivate: h?.isPrivate ?? false,
      valueIds: h?.valueIds ?? [],
      source: e.source,
    });
  }
  return out;
}

/** Net units per receiver of every gift, over all time. */
export function netByGift(entries: readonly LedgerEntry[]): Map<GiftId, Map<MemberId, number>> {
  const out = new Map<GiftId, Map<MemberId, number>>();
  for (const e of entries) {
    if ((e.kind !== "gift" && e.kind !== "gift_reversal") || e.cause.type !== "gift") continue;
    let per = out.get(e.cause.giftId);
    if (!per) out.set(e.cause.giftId, (per = new Map()));
    per.set(e.memberId, (per.get(e.memberId) ?? 0) + signedAmount(e));
  }
  return out;
}

/** S7, S80: active members not excluded from boards, in id order. */
export function boardMembers(data: Pick<BoardData, "members" | "insights">): MemberRecord[] {
  const excluded = new Set(data.insights.excludedFromBoards);
  return data.members.filter((r) => r.active && !excluded.has(r.id)).sort((a, b) => cmp(a.id, b.id));
}

export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function addTo<K>(map: Map<K, number>, key: K, n: number): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

/** Rounded to one decimal; 0 when the denominator is 0. */
export const percent = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);
export const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 100) / 100);
