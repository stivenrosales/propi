// S6, S7: plans and entitlement. Pure: the subscription record and member count come from ports.
//
// Plans: Free (up to FREE_MEMBER_LIMIT active members), Pro (billed per member per month by the
// billing provider), Comped (treated as Pro, never billed). "Active member" means a member who is not
// deactivated (`member.active`); it is the simplest count the data supports and the one admins control.
// Recognition is never limited by the plan; only new reward shop redemptions are (see decideRedeem).
import type { Instant, WorkspaceId } from "../shared/types.ts";

export const FREE_MEMBER_LIMIT = 5;

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

/** S12a: a workspace with a live subscription (Pro by isProSubscription) cannot start a second checkout. */
export function canStartCheckout(account: BillingAccount, now: Instant): boolean {
  return account.subscription === null || !isProSubscription(account.subscription, now);
}

/** Statuses whose seats follow the active member count (S11); past_due and canceled are left alone. */
const SEAT_SYNCED: readonly string[] = ["active", "trialing"];

/**
 * S11: the seat count to set on the workspace's Polar subscription, or null when nothing changes:
 * comped, Free, not seat-based, not active/trialing, or the seats already equal the active members
 * (at least 1 seat).
 */
export function seatTarget(account: BillingAccount, activeMembers: number): number | null {
  const s = account.subscription;
  // A subscription set to cancel at period end keeps its seats until it ends.
  if (account.comped || s === null || s.seats === null || s.cancelAtPeriodEnd || !SEAT_SYNCED.includes(s.status)) return null;
  const target = Math.max(1, activeMembers);
  return target === s.seats ? null : target;
}

/** S11: the provider call that changes a subscription's seats (proration per the provider default). */
export interface SeatUpdater {
  updateSeats(subscriptionId: string, seats: number): Promise<void>;
}

/**
 * "foreign" (S12a): the event is for another subscription id while the stored one is still live; it is
 * recorded (idempotency) but does not replace the stored subscription.
 */
export type ApplyBillingResult = "applied" | "duplicate" | "stale" | "foreign" | "unknown_workspace";

/** S6: subscription records and comped flags, kept per workspace. */
export interface BillingStore {
  account(ws: WorkspaceId): Promise<BillingAccount>;
  /**
   * Record one provider event and upsert its subscription in one transaction. Idempotent by
   * (provider, eventId): a replay returns "duplicate" and changes nothing; an event older than the
   * stored record is recorded but does not overwrite it ("stale"). S12a: an event for a different
   * subscription id than the stored one applies only when the stored one is no longer live
   * (isProSubscription at receivedAt), otherwise "foreign".
   */
  applySubscriptionEvent(e: { readonly eventId: string; readonly type: string; readonly receivedAt: Instant; readonly subscription: SubscriptionRecord }): Promise<ApplyBillingResult>;
  /** S11: the seats just set at the provider, stored on the subscription with that id only. */
  recordSeats(ws: WorkspaceId, subscriptionId: string, seats: number): Promise<void>;
  /** Comped workspaces are treated as Pro and never billed. */
  setComped(ws: WorkspaceId, comped: boolean): Promise<void>;
}
