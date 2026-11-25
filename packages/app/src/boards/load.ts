// Loads the BoardData every board, report and insight query folds over. Read-only; never locks.
import type { Ports, WorkspaceId } from "@propi/core";
import type { BoardData, InsightsSource } from "@propi/core/boards";
import type { Summarizer } from "@propi/core/insights";

export interface InsightsDeps {
  readonly ports: Ports;
  readonly source: InsightsSource;
  /** S91: required only by the monthly digest. */
  readonly summarizer?: Summarizer;
}

export async function loadBoardData(d: InsightsDeps, ws: WorkspaceId): Promise<BoardData> {
  const reader = d.ports.reader.workspace(ws);
  const [entries, gifts, members, values, workspace, insights] = await Promise.all([
    reader.entries(),
    d.source.gifts(ws),
    d.ports.directory.members(ws),
    d.ports.directory.values(ws),
    d.ports.directory.settings(ws),
    d.source.settings(ws),
  ]);
  return { entries, gifts, members, values, workspace, insights };
}
