// S6, S7: the workspace plan, read from the billing store and the member directory.
import { activeMemberCount, planState, type BillingStore, type Clock, type Directory, type PlanState, type WorkspaceId } from "@propi/core";

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
