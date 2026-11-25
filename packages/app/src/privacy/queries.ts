// S71: the full CSV export. Reads everything, with no date range.
import type { Actor, Outcome, WorkspaceId } from "@propi/core";
import { canExport, exportAll, toCsv, type ExportTables } from "@propi/core/privacy";
import { loadBoardData, type InsightsDeps } from "../boards/load.ts";

export interface ExportResult {
  readonly tables: ExportTables;
  readonly csv: { readonly [K in keyof ExportTables]: string };
}

export interface PrivacyQueries {
  exportAll(ws: WorkspaceId, viewer: Actor | null): Promise<Outcome<ExportResult>>;
}

export function privacyQueries(d: InsightsDeps): PrivacyQueries {
  return {
    async exportAll(ws, viewer) {
      if (!canExport(viewer)) return { ok: false, error: { code: "forbidden", need: "admin" } };
      const [data, redemptions] = await Promise.all([loadBoardData(d, ws), d.source.redemptions(ws)]);
      const tables = exportAll({ entries: data.entries, gifts: data.gifts, members: data.members, redemptions });
      return {
        ok: true,
        value: { tables, csv: { gifts: toCsv(tables.gifts), ledger: toCsv(tables.ledger), redemptions: toCsv(tables.redemptions), members: toCsv(tables.members) } },
      };
    },
  };
}
