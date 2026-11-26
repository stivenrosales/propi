// S6, S7: the workspace plan, read from the billing store and the member directory.
// S11: seat sync, which sets each Pro subscription's seats to the workspace's active member count.
import { activeMemberCount, planState, seatTarget, type BillingStore, type Clock, type Directory, type PlanState, type SeatUpdater, type WorkspaceId } from "@propi/core";

export interface PlanDeps {
  readonly billing: BillingStore;
  readonly directory: Directory;
  readonly clock: Clock;
}

/** S7: the plan, active member count and whether a Free workspace is over its limit. */
export async function workspacePlan(d: PlanDeps, ws: WorkspaceId): Promise<PlanState> {
  const [account, members] = await Promise.all([d.billing.account(ws), d.directory.members(ws)]);
  return planState(account, activeMemberCount(members), d.clock.now());
}

export interface SeatSyncReport {
  readonly updated: readonly { readonly workspaceId: WorkspaceId; readonly from: number | null; readonly to: number }[];
  readonly failed: readonly { readonly workspaceId: WorkspaceId; readonly error: string }[];
  /** Workspaces with nothing to change (seats match, comped, Free, or not active/trialing). */
  readonly unchanged: number;
}

/**
 * S11: for each workspace, when its active/trialing Pro subscription's seats differ from the active
 * member count (at least 1), set the seats at the provider, then store them. Idempotent: a second run
 * with the same members calls nothing. One workspace's failure is reported and never stops the others.
 * The provider's subscription webhooks stay the source of truth and overwrite the stored seats.
 */
export async function syncSeats(d: PlanDeps & { readonly seats: SeatUpdater }, workspaces: readonly WorkspaceId[]): Promise<SeatSyncReport> {
  const updated: SeatSyncReport["updated"][number][] = [];
  const failed: SeatSyncReport["failed"][number][] = [];
  let unchanged = 0;
  for (const ws of workspaces) {
    try {
      const [account, members] = await Promise.all([d.billing.account(ws), d.directory.members(ws)]);
      const to = seatTarget(account, activeMemberCount(members));
      const sub = account.subscription;
      if (to === null || sub === null) {
        unchanged++;
        continue;
      }
      await d.seats.updateSeats(sub.subscriptionId, to);
      await d.billing.recordSeats(ws, sub.subscriptionId, to);
      updated.push({ workspaceId: ws, from: sub.seats, to });
    } catch (e) {
      failed.push({ workspaceId: ws, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { updated, failed, unchanged };
}
