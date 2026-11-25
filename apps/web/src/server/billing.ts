// S6, S7: billing for the web process. The Postgres billing store and the workspace plan; Polar is
// optional: without POLAR_* env the app works as before and the billing page says so.
import { workspacePlan, type BillingStore, type PlanState, type SubscriptionRecord, type WorkspaceId } from "@propi/app";
import { createDbBilling, systemClock } from "@propi/db";
import { polarConfig } from "./env";
import { propi } from "./propi";

const holder = globalThis as unknown as { __propiBilling?: BillingStore };

export function billingStore(): BillingStore {
  return (holder.__propiBilling ??= createDbBilling(propi().prisma));
}

export interface BillingView {
  /** False when Polar is not configured: no plan limit applies. */
  readonly configured: boolean;
  readonly plan: PlanState;
  readonly subscription: SubscriptionRecord | null;
}

export async function billingView(ws: WorkspaceId): Promise<BillingView> {
  const billing = billingStore();
  const [plan, account] = await Promise.all([workspacePlan({ billing, directory: propi().ports.directory, clock: systemClock }, ws), billing.account(ws)]);
  return { configured: polarConfig() !== null, plan, subscription: account.subscription };
}

/** S7: the admin banner shows only when billing is configured and a Free workspace is over its limit. */
export async function overPlanLimit(ws: WorkspaceId): Promise<PlanState | null> {
  if (polarConfig() === null) return null;
  const v = await billingView(ws);
  return v.plan.overLimit ? v.plan : null;
}
