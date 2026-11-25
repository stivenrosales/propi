// Parses leaderboard filters from the query string into core's Timeframe (S80). No rules here:
// core's rangeOf turns the timeframe into local dates in the workspace timezone.
import type { LocalDate } from "@propi/core";
import type { BoardKind, Timeframe } from "@propi/core/boards";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TIMEFRAMES = ["today", "week", "month", "year", "all", "custom"] as const;

export function parseTimeframe(kind: string | undefined, from: string | undefined, to: string | undefined): Timeframe {
  switch (kind) {
    case "today":
    case "week":
    case "year":
    case "all":
      return { kind };
    case "custom":
      if (from && to && DATE.test(from) && DATE.test(to)) return { kind: "custom", from: from as LocalDate, to: to as LocalDate };
      return { kind: "month" };
    default:
      return { kind: "month" };
  }
}

export function parseBoard(board: string | undefined, visible: readonly BoardKind[]): BoardKind {
  return visible.includes(board as BoardKind) ? (board as BoardKind) : (visible[0] ?? "given");
}
