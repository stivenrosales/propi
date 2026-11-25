// S87: what an office TV shows — the live public feed and a leaderboard.
import type { Instant } from "../shared/types.ts";
import { feed, type FeedItem } from "./feed.ts";
import { boardsVisibleTo, leaderboard, type BoardKind, type LeaderboardRow } from "./leaderboard.ts";
import type { Timeframe } from "./periods.ts";
import type { BoardData } from "./source.ts";

export interface DisplayOptions {
  readonly feedSize?: number;
  readonly boardSize?: number;
  readonly timeframe?: Timeframe;
}

export interface DisplayData {
  readonly feed: readonly FeedItem[];
  readonly board: BoardKind;
  readonly timeframe: Timeframe;
  readonly leaderboard: readonly LeaderboardRow[];
}

export function tvDisplay(data: BoardData, now: Instant, opts: DisplayOptions = {}): DisplayData {
  // A screen is public: giver mode (S81) applies to it like to any member.
  const board = boardsVisibleTo(null, data.insights)[0] ?? "given";
  const timeframe = opts.timeframe ?? { kind: "month" };
  return {
    feed: feed(data, { limit: opts.feedSize ?? 20 }),
    board,
    timeframe,
    leaderboard: leaderboard(data, { board, timeframe, limit: opts.boardSize ?? 10 }, now),
  };
}
