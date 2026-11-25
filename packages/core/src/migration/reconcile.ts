// S103, S105, G9: reconciliation checks completeness, not only totals. Aggregate counts only.
import type { MemberId } from "../shared/types.ts";
import { ZERO_BALANCES, type Balances } from "../ledger/replay.ts";
import type { ImportPlan } from "./types.ts";

export interface ImportCounts {
  /** Gift entries the import wrote (one per activity row). */
  readonly activityImported: number;
  /** Spend entries the import wrote (one per redemption row). */
  readonly redemptionsImported: number;
  /** Ledger entries added by running the same import again (S105: must be 0). */
  readonly secondImportAdded: number;
}

export interface ReconcileReport {
  readonly ok: boolean;
  readonly currentUsers: number;
  readonly activityRowsRead: number;
  readonly activityRowsImported: number;
  readonly redemptionRowsRead: number;
  readonly redemptionRowsImported: number;
  readonly secondImportAdded: number;
  readonly givenByCurrentMembers: number;
  readonly membersWithDiff: { readonly received: number; readonly given: number; readonly redeemable: number; readonly any: number };
}

export function reconcileImport(plan: ImportPlan, balances: ReadonlyMap<MemberId, Balances>, counts: ImportCounts): ReconcileReport {
  const diff = { received: 0, given: 0, redeemable: 0, any: 0 };
  let givenByCurrentMembers = 0;
  for (const u of plan.expected) {
    const b = balances.get(u.memberId) ?? ZERO_BALANCES;
    givenByCurrentMembers += b.given;
    const d = { received: b.received !== u.received, given: b.given !== u.given, redeemable: b.redeemable !== u.redeemable };
    if (d.received) diff.received++;
    if (d.given) diff.given++;
    if (d.redeemable) diff.redeemable++;
    if (d.received || d.given || d.redeemable) diff.any++;
  }
  const activityRowsRead = plan.stats.activityInWindow;
  const redemptionRowsRead = plan.stats.redemptionInWindow;
  const ok =
    diff.any === 0 &&
    counts.activityImported === activityRowsRead &&
    counts.redemptionsImported === redemptionRowsRead &&
    counts.secondImportAdded === 0;
  return {
    ok,
    currentUsers: plan.expected.length,
    activityRowsRead,
    activityRowsImported: counts.activityImported,
    redemptionRowsRead,
    redemptionRowsImported: counts.redemptionsImported,
    secondImportAdded: counts.secondImportAdded,
    givenByCurrentMembers,
    membersWithDiff: diff,
  };
}
