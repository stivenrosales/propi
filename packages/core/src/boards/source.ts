// The read model every board, report and insight folds over: ledger entries plus gift headers
// (architecture §1.3). Queries are pure functions of BoardData, so the db adapter can answer the
// same questions in SQL and be checked against these folds.
import type { Gift } from "../giving/types.ts";
import type { LedgerEntry } from "../ledger/entries.ts";
import type { MemberRecord } from "../members/members.ts";
import type { NotificationPreferences } from "../notify/preferences.ts";
import type { ExportRedemptionRow } from "../privacy/export.ts";
import type { MemberId, WorkspaceId } from "../shared/types.ts";
import type { Value } from "../values/values.ts";
import type { WorkspaceSettings } from "../workspace/settings.ts";

/** Workspace toggles for boards, notifications and insights. */
export interface InsightsSettings {
  /** S69: show private-channel gifts in feeds and profiles. */
  readonly showPrivateGifts: boolean;
  /** S81: members see only the `given` board. */
  readonly giverMode: boolean;
  /** S80: members hidden from every board. */
  readonly excludedFromBoards: readonly MemberId[];
  /** S86: the weekly nudge; weekday 1 = Monday ... 7 = Sunday. */
  readonly nudge: { readonly enabled: boolean; readonly weekday: number };
  /** S89: weeks without receiving before an isolation alert. */
  readonly isolationWeeks: number;
  /** S90: flag pairs where each sends >= minSharePercent of their units to the other, over >= minGifts gifts. */
  readonly reciprocity: { readonly minSharePercent: number; readonly minGifts: number };
  /** S84: link to the shop in the weekly report. */
  readonly shopUrl: string | null;
}

export function defaultInsightsSettings(over: Partial<InsightsSettings> = {}): InsightsSettings {
  return {
    showPrivateGifts: false,
    giverMode: false,
    excludedFromBoards: [],
    nudge: { enabled: true, weekday: 5 },
    isolationWeeks: 3,
    reciprocity: { minSharePercent: 50, minGifts: 6 },
    shopUrl: null,
    ...over,
  };
}

/** Everything a query reads about one workspace. */
export interface BoardData {
  readonly entries: readonly LedgerEntry[];
  readonly gifts: readonly Gift[];
  readonly members: readonly MemberRecord[];
  readonly values: readonly Value[];
  readonly workspace: WorkspaceSettings;
  readonly insights: InsightsSettings;
}

/** Port: reads the boards module needs beyond the core Reader/Directory. */
export interface InsightsSource {
  gifts(ws: WorkspaceId): Promise<readonly Gift[]>;
  settings(ws: WorkspaceId): Promise<InsightsSettings>;
  preferences(ws: WorkspaceId): Promise<ReadonlyMap<MemberId, NotificationPreferences>>;
  /** Owned by the shop module; mapped to the export row shape by the adapter (S71). */
  redemptions(ws: WorkspaceId): Promise<readonly ExportRedemptionRow[]>;
}
