// S43: who embodies which value — tagged units received per member and value in a period.
import type { MemberId, ValueId } from "../shared/types.ts";
import { cmp, giftLines } from "./facts.ts";
import { filterLines } from "./leaderboard.ts";
import type { DateRange } from "./periods.ts";
import type { BoardData } from "./source.ts";

export interface ValueReportRow {
  readonly memberId: MemberId;
  readonly valueId: ValueId;
  /** Gifts with net units > 0 in the period. */
  readonly gifts: number;
  readonly units: number;
}

export function valuesReport(data: BoardData, range: DateRange): ValueReportRow[] {
  // Net per (receiver, gift) inside the range, so a gift reversed in the period counts nothing.
  const net = new Map<string, { receiver: MemberId; valueIds: readonly ValueId[]; units: number }>();
  for (const l of filterLines(giftLines(data), { range })) {
    if (l.valueIds.length === 0) continue;
    const k = `${l.receiver}|${l.giftKey}`;
    const row = net.get(k) ?? { receiver: l.receiver, valueIds: l.valueIds, units: 0 };
    row.units += l.units;
    net.set(k, row);
  }
  const acc = new Map<string, { memberId: MemberId; valueId: ValueId; gifts: number; units: number }>();
  for (const { receiver, valueIds, units } of net.values()) {
    if (units <= 0) continue;
    for (const valueId of valueIds) {
      const k = `${receiver}|${valueId}`;
      const row = acc.get(k) ?? { memberId: receiver, valueId, gifts: 0, units: 0 };
      row.gifts += 1;
      row.units += units;
      acc.set(k, row);
    }
  }
  return [...acc.values()].sort((a, b) => cmp(a.memberId, b.memberId) || b.units - a.units || cmp(a.valueId, b.valueId));
}
