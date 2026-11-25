// Board queries (S43, S69, S80-S82, S84, S87): load BoardData, run the pure core fold.
import type { Actor, MemberId, Outcome, WorkspaceId } from "@propi/core";
import {
  authorizeBoard,
  boardsVisibleTo,
  feed,
  leaderboard,
  rangeOf,
  tvDisplay,
  valuesReport,
  weeklyReport,
  type BoardKind,
  type DisplayData,
  type DisplayOptions,
  type FeedItem,
  type FeedOptions,
  type LeaderboardQuery,
  type LeaderboardRow,
  type Timeframe,
  type ValueReportRow,
  type WeeklyReport,
} from "@propi/core/boards";
import { loadBoardData, type InsightsDeps } from "./load.ts";

export interface BoardQueries {
  /** S81: which boards this viewer may read. */
  visibleBoards(ws: WorkspaceId, viewer: Actor | null): Promise<BoardKind[]>;
  /** S80-S82. Refused with `forbidden` when giver mode hides the board from the viewer. */
  leaderboard(ws: WorkspaceId, viewer: Actor | null, q: LeaderboardQuery): Promise<Outcome<LeaderboardRow[]>>;
  /** S43. */
  valuesReport(ws: WorkspaceId, timeframe: Timeframe): Promise<ValueReportRow[]>;
  /** S69: the public feed. */
  feed(ws: WorkspaceId, opts: FeedOptions): Promise<FeedItem[]>;
  /** S69: a member's profile feed. */
  profile(ws: WorkspaceId, member: MemberId, limit?: number): Promise<FeedItem[]>;
  /** S84. */
  weeklyReport(ws: WorkspaceId, member: MemberId): Promise<WeeklyReport>;
  /** S87. */
  tvDisplay(ws: WorkspaceId, opts?: DisplayOptions): Promise<DisplayData>;
}

export function boardQueries(d: InsightsDeps): BoardQueries {
  const now = () => d.ports.clock.now();
  return {
    async visibleBoards(ws, viewer) {
      return boardsVisibleTo(viewer, await d.source.settings(ws));
    },
    async leaderboard(ws, viewer, q) {
      const data = await loadBoardData(d, ws);
      const denied = authorizeBoard(viewer, q.board, data.insights);
      if (denied !== null) return { ok: false, error: denied };
      return { ok: true, value: leaderboard(data, q, now()) };
    },
    async valuesReport(ws, timeframe) {
      const data = await loadBoardData(d, ws);
      return valuesReport(data, rangeOf(timeframe, now(), data.workspace.timezone));
    },
    async feed(ws, opts) {
      return feed(await loadBoardData(d, ws), opts);
    },
    async profile(ws, member, limit) {
      return feed(await loadBoardData(d, ws), limit === undefined ? { member } : { member, limit });
    },
    async weeklyReport(ws, member) {
      return weeklyReport(await loadBoardData(d, ws), member, now());
    },
    async tvDisplay(ws, opts = {}) {
      return tvDisplay(await loadBoardData(d, ws), now(), opts);
    },
  };
}
