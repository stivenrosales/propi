// S84: the content of a member's weekly report.
import type { Instant, MemberId } from "../shared/types.ts";
import { replay, ZERO_BALANCES } from "../ledger/replay.ts";
import { localDate } from "../workspace/time.ts";
import { addTo, boardMembers, cmp, giftLines, type GiftLine } from "./facts.ts";
import { filterLines } from "./leaderboard.ts";
import { isoWeekKey, sameSpanLastMonth, weekStart, type DateRange } from "./periods.ts";
import type { BoardData } from "./source.ts";

export interface UnitsBy {
  readonly memberId: MemberId;
  readonly units: number;
}

export interface WeeklyReport {
  readonly memberId: MemberId;
  readonly week: string;
  /** Units given by everyone, month to date vs the same point last month. */
  readonly team: { readonly monthToDate: number; readonly lastMonthSamePoint: number };
  /** This week's top givers. */
  readonly topGivers: readonly UnitsBy[];
  /** The member's own giving, month to date vs the same point last month. */
  readonly own: { readonly monthToDate: number; readonly lastMonthSamePoint: number };
  /** Who the member gave to this week. */
  readonly gaveTo: readonly UnitsBy[];
  readonly redeemable: number;
  readonly shopUrl: string | null;
}

const sum = (lines: readonly GiftLine[]) => lines.reduce((t, l) => t + l.units, 0);

function ranked(map: Map<MemberId, number>, keep: (m: MemberId) => boolean, limit?: number): UnitsBy[] {
  const rows = [...map]
    .filter(([id, units]) => units > 0 && keep(id))
    .map(([memberId, units]) => ({ memberId, units }))
    .sort((a, b) => b.units - a.units || cmp(a.memberId, b.memberId));
  return limit === undefined ? rows : rows.slice(0, limit);
}

export function weeklyReport(data: BoardData, member: MemberId, now: Instant, opts: { readonly topGivers?: number } = {}): WeeklyReport {
  const today = localDate(now, data.workspace.timezone);
  const lines = giftLines(data);
  const mtd: DateRange = { from: `${today.slice(0, 7)}-01` as DateRange["from"], to: today };
  const last = sameSpanLastMonth(today);
  const week: DateRange = { from: weekStart(today), to: today };
  const mine = (ls: readonly GiftLine[]) => ls.filter((l) => l.giver === member);

  const givers = new Map<MemberId, number>();
  const gaveTo = new Map<MemberId, number>();
  for (const l of filterLines(lines, { range: week })) {
    if (l.giver !== null) addTo(givers, l.giver, l.units);
    if (l.giver === member) addTo(gaveTo, l.receiver, l.units);
  }
  const visible = new Set(boardMembers(data).map((r) => r.id));
  return {
    memberId: member,
    week: isoWeekKey(today),
    team: { monthToDate: sum(filterLines(lines, { range: mtd })), lastMonthSamePoint: sum(filterLines(lines, { range: last })) },
    topGivers: ranked(givers, (id) => visible.has(id), opts.topGivers ?? 3),
    own: { monthToDate: sum(mine(filterLines(lines, { range: mtd }))), lastMonthSamePoint: sum(mine(filterLines(lines, { range: last }))) },
    gaveTo: ranked(gaveTo, () => true),
    redeemable: (replay(data.entries).get(member) ?? ZERO_BALANCES).redeemable,
    shopUrl: data.insights.shopUrl,
  };
}
