// S6, S7: plans and entitlement. Pure: the subscription record and member count come from ports.
//
// Plans: Free (up to FREE_MEMBER_LIMIT active members), Pro (billed per member per month by the
// billing provider), Comped (treated as Pro, never billed). "Active member" means a member who is not
// deactivated (`member.active`); it is the simplest count the data supports and the one admins control.
// Recognition is never limited by the plan; only new reward shop redemptions are (see decideRedeem).
import type { Instant, WorkspaceId } from "../shared/types.ts";

export const FREE_MEMBER_LIMIT = 10;

export type PlanName = "free" | "pro" | "comped";

/** The provider's subscription statuses (Polar uses Stripe's set). */
export type SubscriptionStatus = "incomplete" | "incomplete_expired" | "trialing" | "active" | "past_due" | "canceled" | "unpaid";

/** One workspace's paid subscription, as last reported by the billing provider. */
export interface SubscriptionRecord {
  readonly workspaceId: WorkspaceId;
  readonly provider: "polar";
  readonly subscriptionId: string;
  readonly customerId: string | null;
  readonly status: SubscriptionStatus | (string & {});
  readonly currentPeriodEnd: Instant | null;
  readonly cancelAtPeriodEnd: boolean;
  /** Seats bought (seat-based pricing); null when the price is not seat-based. */
  readonly seats: number | null;
  /** The provider's modification time: an older report never overwrites a newer one. */
  readonly sourceUpdatedAt: Instant;
}

export interface BillingAccount {
  readonly subscription: SubscriptionRecord | null;
  readonly comped: boolean;
}

export interface PlanState {
  readonly plan: PlanName;
  readonly activeMembers: number;
  /** Null when the plan has no member limit. */
  readonly limit: number | null;
  readonly overLimit: boolean;
}

/** Statuses that keep Pro while the provider still collects (past_due retries the payment). */
const PAID: readonly string[] = ["active", "trialing", "past_due"];

/** Pro while paid, or canceled but still inside the period already paid for. */
export function isProSubscription(s: SubscriptionRecord, now: Instant): boolean {
  if (PAID.includes(s.status)) return true;
  return s.status === "canceled" && s.currentPeriodEnd !== null && s.currentPeriodEnd > now;
}

/** S7: the plan a workspace is on and whether it is over the Free member limit. */
export function planState(account: BillingAccount, activeMembers: number, now: Instant): PlanState {
  if (account.comped) return { plan: "comped", activeMembers, limit: null, overLimit: false };
  if (account.subscription !== null && isProSubscription(account.subscription, now)) return { plan: "pro", activeMembers, limit: null, overLimit: false };
  return { plan: "free", activeMembers, limit: FREE_MEMBER_LIMIT, overLimit: activeMembers > FREE_MEMBER_LIMIT };
}

export function activeMemberCount(members: readonly { readonly active: boolean }[]): number {
  return members.filter((m) => m.active).length;
}

export type ApplyBillingResult = "applied" | "duplicate" | "stale" | "unknown_workspace";

/** S6: subscription records and comped flags, kept per workspace. */
export interface BillingStore {
  account(ws: WorkspaceId): Promise<BillingAccount>;
  /**
   * Record one provider event and upsert its subscription in one transaction. Idempotent by
   * (provider, eventId): a replay returns "duplicate" and changes nothing; an event older than the
   * stored record is recorded but does not overwrite it ("stale").
   */
  applySubscriptionEvent(e: { readonly eventId: string; readonly type: string; readonly receivedAt: Instant; readonly subscription: SubscriptionRecord }): Promise<ApplyBillingResult>;
  /** Comped workspaces are treated as Pro and never billed. */
  setComped(ws: WorkspaceId, comped: boolean): Promise<void>;
}
