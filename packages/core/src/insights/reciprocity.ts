// S90: flag pairs where >= X% of each one's given units go to the other, over >= Y gifts in the
// period. Flags are for admin review only; nothing is blocked.
import type { MemberId } from "../shared/types.ts";
import { addTo, cmp, giftLines, percent } from "../boards/facts.ts";
import { filterLines } from "../boards/leaderboard.ts";
import type { DateRange } from "../boards/periods.ts";
import type { BoardData, InsightsSettings } from "../boards/source.ts";

export interface ReciprocityFlag {
  /** a < b by id. */
  readonly a: MemberId;
  readonly b: MemberId;
  readonly aToB: number;
  readonly bToA: number;
  readonly aSharePercent: number;
  readonly bSharePercent: number;
  /** Gifts exchanged between the two, both directions. */
  readonly gifts: number;
}

export function reciprocityFlags(data: BoardData, range: DateRange, t: InsightsSettings["reciprocity"] = data.insights.reciprocity): ReciprocityFlag[] {
  const pairUnits = new Map<string, number>(); // "giver|receiver"
  const pairGift = new Map<string, number>(); // "giver|receiver|gift" -> net units
  const totalGiven = new Map<MemberId, number>();
  for (const l of filterLines(giftLines(data), { range })) {
    if (l.giver === null) continue;
    addTo(pairUnits, `${l.giver}|${l.receiver}`, l.units);
    addTo(pairGift, `${l.giver}|${l.receiver}|${l.giftKey}`, l.units);
    addTo(totalGiven, l.giver, l.units);
  }
  const giftCount = new Map<string, number>();
  for (const [k, units] of pairGift) if (units > 0) addTo(giftCount, k.split("|").slice(0, 2).join("|"), 1);

  const flags: ReciprocityFlag[] = [];
  for (const key of pairUnits.keys()) {
    const [x, y] = key.split("|") as [MemberId, MemberId];
    if (!(x < y) || !pairUnits.has(`${y}|${x}`)) continue;
    const aToB = Math.max(0, pairUnits.get(`${x}|${y}`) ?? 0);
    const bToA = Math.max(0, pairUnits.get(`${y}|${x}`) ?? 0);
    const aSharePercent = percent(aToB, totalGiven.get(x) ?? 0);
    const bSharePercent = percent(bToA, totalGiven.get(y) ?? 0);
    const gifts = (giftCount.get(`${x}|${y}`) ?? 0) + (giftCount.get(`${y}|${x}`) ?? 0);
    if (aSharePercent >= t.minSharePercent && bSharePercent >= t.minSharePercent && gifts >= t.minGifts) flags.push({ a: x, b: y, aToB, bToA, aSharePercent, bSharePercent, gifts });
  }
  return flags.sort((p, q) => cmp(p.a, q.a) || cmp(p.b, q.b));
}
