// S80-S82: leaderboards. GROUP BY member over gift lines in a range, with channel and value filters.
import type { Actor, DomainError, Instant, MemberId, ValueId } from "../shared/types.ts";
import { addTo, boardMembers, cmp, giftLines, type GiftLine } from "./facts.ts";
import { inRange, rangeOf, type DateRange, type Timeframe } from "./periods.ts";
import type { BoardData, InsightsSettings } from "./source.ts";

export type BoardKind = "received" | "given" | "combined";
export const BOARD_KINDS: readonly BoardKind[] = ["received", "given", "combined"];

export interface LeaderboardQuery {
  readonly board: BoardKind;
  readonly timeframe: Timeframe;
  /** S80: only gifts given in this channel. */
  readonly channelId?: string | null;
  /** S82: only gifts tagged with this value. */
  readonly valueId?: ValueId | null;
  readonly limit?: number;
}

export interface LeaderboardRow {
  /** Competition ranking: ties share a rank (1, 1, 3). */
  readonly rank: number;
  readonly memberId: MemberId;
  readonly score: number;
  readonly received: number;
  readonly given: number;
}

export interface LineFilter {
  readonly range: DateRange;
  readonly channelId?: string | null;
  readonly valueId?: ValueId | null;
}

export function filterLines(lines: readonly GiftLine[], f: LineFilter): GiftLine[] {
  return lines.filter(
    (l) =>
      inRange(l.day, f.range) &&
      (f.channelId == null || l.channelId === f.channelId) &&
      (f.valueId == null || l.valueIds.includes(f.valueId)),
  );
}

export function leaderboard(data: BoardData, q: LeaderboardQuery, now: Instant): LeaderboardRow[] {
  const range = rangeOf(q.timeframe, now, data.workspace.timezone);
  const received = new Map<MemberId, number>();
  const given = new Map<MemberId, number>();
  for (const l of filterLines(giftLines(data), { range, channelId: q.channelId ?? null, valueId: q.valueId ?? null })) {
    addTo(received, l.receiver, l.units);
    if (l.giver !== null) addTo(given, l.giver, l.units);
  }
  const rows = boardMembers(data)
    .map((r) => {
      const rec = received.get(r.id) ?? 0;
      const giv = given.get(r.id) ?? 0;
      const score = q.board === "received" ? rec : q.board === "given" ? giv : rec + giv;
      return { memberId: r.id, score, received: rec, given: giv };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || cmp(a.memberId, b.memberId));
  const ranked: LeaderboardRow[] = [];
  rows.forEach((r, i) => {
    const prev = ranked[i - 1];
    ranked.push({ rank: prev !== undefined && prev.score === r.score ? prev.rank : i + 1, ...r });
  });
  return q.limit === undefined ? ranked : ranked.slice(0, q.limit);
}

/** Who sees every board regardless of giver mode: admins, API integrations and system jobs. */
export function seesAllBoards(viewer: Actor | null): boolean {
  if (viewer === null) return false;
  if (viewer.kind === "member") return viewer.role === "admin";
  return viewer.kind === "apiToken" || viewer.kind === "system";
}

/** S81: giver mode shows members (and public screens, viewer null) only the given board. */
export function boardsVisibleTo(viewer: Actor | null, s: InsightsSettings): BoardKind[] {
  return s.giverMode && !seesAllBoards(viewer) ? ["given"] : [...BOARD_KINDS];
}

export function authorizeBoard(viewer: Actor | null, board: BoardKind, s: InsightsSettings): DomainError | null {
  return boardsVisibleTo(viewer, s).includes(board) ? null : { code: "forbidden", need: "admin" };
}
