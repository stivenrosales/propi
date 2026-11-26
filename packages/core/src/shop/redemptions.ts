// S35, S46-S55, S108: redemptions as pure deciders. Docs: docs/statecharts/redemption.
import { isPosInt, type Instant, type MemberId } from "../shared/types.ts";
import type { MemberRecord } from "../members/members.ts";
import type { PlanState } from "../billing/index.ts";
import type { NewEntry } from "../ledger/entries.ts";
import { stockOf } from "./catalog.ts";
import { canManageShop, canTransition, nextState, shopAccept, shopEntry, shopReject, sortedIds } from "./rules.ts";
import type {
  Collab,
  Money,
  OnBehalfOf,
  RecordGiftCardIssued,
  Redeem,
  Redemption,
  RedemptionEventType,
  RedemptionId,
  RedemptionState,
  Reward,
  ShopDecision,
  ShopEvent,
  ShopResults,
  ShopSettings,
  ShopWrite,
  TransitionRedemption,
} from "./types.ts";

export interface RedeemSnapshot {
  readonly member: MemberRecord | null;
  readonly redeemable: number;
  readonly reward: Reward | null;
  readonly settings: ShopSettings;
  /** S47: the budget month of this redemption and what is already spent in it. */
  readonly budgetMonth: string;
  readonly budgetSpent: number;
  /** S108: provider balance minus reservations; null without a provider. */
  readonly prepaidAvailable: Money | null;
  readonly redemptionId: RedemptionId;
  /** S7: the workspace plan; absent or null when billing is not configured (no limit). */
  readonly plan?: PlanState | null;
}

export function redemptionEvent(type: RedemptionEventType, r: Redemption, notify: readonly MemberId[]): ShopEvent {
  return { type, redemptionId: r.id, rewardId: r.rewardId, collabId: r.collabId, cost: r.cost, notify };
}

/** Who redeems: the member for themselves, an admin on their behalf (S55), or an API token / job. */
function onBehalfOf(cmd: Redeem): OnBehalfOf | null {
  const a = cmd.actor;
  switch (a.kind) {
    case "member":
      if (a.memberId === cmd.memberId) return "self";
      return a.role === "admin" ? { admin: a.memberId } : null;
    case "apiToken":
      return a.scopes.includes("redemptions:write") ? "self" : null;
    case "system":
      return "self";
    case "bot":
      return null;
  }
}

/**
 * S7: a Free workspace over its member limit takes no new redemptions, and (S12b) no contributions to
 * group rewards; recognition is unaffected. Null plan = billing not configured (no limit).
 */
export function planLimitReject<T>(plan: PlanState | null | undefined): ShopDecision<T> | null {
  if (plan?.overLimit !== true) return null;
  return shopReject({ code: "plan_limit", limit: plan.limit ?? 0, activeMembers: plan.activeMembers });
}

/**
 * S50: check redeemable >= cost (S35), stock (S46), budget (S47) and prepaid balance (S108);
 * then debit, reserve stock and create the redemption in one decision.
 * S52: auto-approval skips pending; S55: an admin's manual redemption is approved by its maker;
 * S108: an approved gift card is fulfilled at once.
 */
export function decideRedeem(s: RedeemSnapshot, cmd: Redeem, now: Instant): ShopDecision<ShopResults["Redeem"]> {
  const behalf = onBehalfOf(cmd);
  if (behalf === null) return shopReject({ code: "forbidden", need: "admin" });
  if (s.member === null) return shopReject({ code: "unknown_member", memberId: cmd.memberId });
  if (!s.member.active) return shopReject({ code: "inactive_member" });
  const limited = planLimitReject<ShopResults["Redeem"]>(s.plan);
  if (limited !== null) return limited;
  const reward = s.reward;
  if (reward === null) return shopReject({ code: "reward_not_found" });
  if (reward.status !== "active") return shopReject({ code: "reward_not_active" });
  const slot = stockOf(reward, cmd.variantId);
  if (!slot.ok) return shopReject({ code: "invalid_variant" });
  if (slot.stock !== null && slot.stock <= 0) return shopReject({ code: "out_of_stock" });
  if (s.redeemable < reward.cost) return shopReject({ code: "insufficient_redeemable", cost: reward.cost, redeemable: s.redeemable });

  const money = reward.internalCost;
  const budget = s.settings.monthlyBudget;
  const budgeted = budget !== null && money !== null;
  if (budgeted && s.budgetSpent + money.minor > budget.minor) {
    return shopReject({ code: "budget_exceeded", remaining: { minor: Math.max(0, budget.minor - s.budgetSpent), currency: budget.currency } });
  }
  if (reward.giftCard && money !== null) {
    const available = s.prepaidAvailable ?? { minor: 0, currency: money.currency };
    if (available.minor < money.minor) return shopReject({ code: "prepaid_insufficient", available });
  }

  const approved = typeof behalf === "object" || (reward.autoApprove ?? s.settings.autoApprove);
  const state: RedemptionState = approved ? (reward.giftCard ? "fulfilled" : "approved") : "pending";
  const redemption: Redemption = {
    id: s.redemptionId,
    memberId: cmd.memberId,
    rewardId: reward.id,
    variantId: cmd.variantId,
    collabId: null,
    cost: reward.cost,
    internalCost: money,
    budgetMonth: budgeted ? s.budgetMonth : null,
    stockReserved: slot.stock !== null,
    giftCard: reward.giftCard,
    cardIssued: false,
    onBehalfOf: behalf,
    state,
    createdAt: now,
    updatedAt: now,
    reason: null,
  };
  const writes: ShopWrite[] = [];
  if (redemption.stockReserved) writes.push({ t: "shop.stock.take", rewardId: reward.id, variantId: cmd.variantId });
  writes.push({ t: "shop.redemption.put", from: null, redemption });
  const notify = [cmd.memberId];
  const events: ShopEvent[] = [redemptionEvent("redemption.created", redemption, notify)];
  if (approved) events.push(redemptionEvent("redemption.approved", redemption, notify));
  if (state === "fulfilled") events.push(redemptionEvent("redemption.fulfilled", redemption, notify));
  return shopAccept(
    { redemptionId: redemption.id, state, cost: reward.cost, redeemable: s.redeemable - reward.cost },
    { entries: [shopEntry("spend", cmd.memberId, reward.cost, { type: "redemption", redemptionId: redemption.id }, reward.title)], writes, events },
  );
}

export interface TransitionSnapshot {
  readonly redemption: Redemption | null;
  /** The collab of a group redemption (S57), else null. */
  readonly collab: Collab | null;
  /** Net contributions per member of that collab (S58 refund fan-out). */
  readonly contributions: ReadonlyMap<MemberId, number>;
}

/** S58: one refund per contributor of exactly what they still hold in the collab. */
export function collabRefunds(collabId: string, contributions: ReadonlyMap<MemberId, number>, reason: string | null): NewEntry[] {
  const out: NewEntry[] = [];
  for (const m of sortedIds(contributions.keys())) {
    const net = contributions.get(m) ?? 0;
    if (isPosInt(net)) out.push(shopEntry("refund", m, net, { type: "contribution", collabId }, reason));
  }
  return out;
}

/**
 * S49: approve | reject | cancel | fulfil along REDEMPTION_EDGES only.
 * S51: reject/cancel refund the full cost and release stock in the same decision.
 * S53: fulfilling a fulfilled redemption is a no-op. S54: every change emits its event.
 * S57/S58: a group redemption refunds every contributor and moves the collab.
 * S108: approving a gift card fulfils it.
 */
export function decideTransition(s: TransitionSnapshot, cmd: TransitionRedemption, now: Instant): ShopDecision<ShopResults["TransitionRedemption"]> {
  if (!canTransition(cmd.actor, cmd.transition)) return shopReject({ code: "forbidden", need: cmd.transition === "cancel" ? "admin" : "approver" });
  const r = s.redemption;
  if (r === null) return shopReject({ code: "redemption_not_found" });
  if (cmd.transition === "fulfil" && r.state === "fulfilled") return shopAccept({ redemptionId: r.id, state: r.state, changed: false, refunded: 0 });
  const to = nextState(r.state, cmd.transition);
  if (to === null) return shopReject({ code: "illegal_transition", from: r.state, transition: cmd.transition });

  const final: RedemptionState = to === "approved" && r.giftCard ? "fulfilled" : to;
  const next: Redemption = { ...r, state: final, updatedAt: now, reason: cmd.reason ?? r.reason };
  const writes: ShopWrite[] = [{ t: "shop.redemption.put", from: r.state, redemption: next }];
  const entries: NewEntry[] = [];
  const events: ShopEvent[] = [];
  const group = r.collabId !== null && s.collab !== null ? s.collab : null;
  const notify = r.memberId !== null ? [r.memberId] : sortedIds([...s.contributions].filter(([, n]) => n > 0).map(([m]) => m));

  if (to === "rejected" || to === "cancelled") {
    if (r.memberId !== null) entries.push(shopEntry("refund", r.memberId, r.cost, { type: "redemption", redemptionId: r.id }, cmd.reason));
    if (r.stockReserved && r.rewardId !== null) writes.push({ t: "shop.stock.add", rewardId: r.rewardId, variantId: r.variantId, quantity: 1 });
    if (group !== null) {
      entries.push(...collabRefunds(group.id, s.contributions, cmd.reason));
      writes.push({ t: "shop.collab.put", from: group.phase, collab: { ...group, phase: "refunded" } });
    }
  }
  if (final === "fulfilled" && group !== null) writes.push({ t: "shop.collab.put", from: group.phase, collab: { ...group, phase: "delivered" } });

  events.push(redemptionEvent(`redemption.${to}` as RedemptionEventType, next, notify));
  if (final !== to) events.push(redemptionEvent("redemption.fulfilled", next, notify));
  if (group !== null && (to === "rejected" || to === "cancelled")) {
    events.push({ type: "collab.refunded", collabId: group.id, why: to, notify, total: entries.reduce((t, e) => t + e.amount, 0) });
  }
  const refunded = entries.reduce((t, e) => t + e.amount, 0);
  return shopAccept({ redemptionId: r.id, state: final, changed: true, refunded }, { entries, writes, events });
}

/** S108: the relay records that the provider issued the card; issuing twice records once. */
export function decideRecordGiftCardIssued(s: { readonly redemption: Redemption | null }, cmd: RecordGiftCardIssued, now: Instant): ShopDecision<ShopResults["RecordGiftCardIssued"]> {
  if (!canManageShop(cmd.actor)) return shopReject({ code: "forbidden", need: "rewards:write" });
  const r = s.redemption;
  if (r === null || !r.giftCard) return shopReject({ code: "redemption_not_found" });
  if (r.state !== "fulfilled") return shopReject({ code: "illegal_transition", from: r.state, transition: "fulfil" });
  if (r.cardIssued) return shopAccept({ redemptionId: r.id });
  return shopAccept({ redemptionId: r.id }, { writes: [{ t: "shop.redemption.put", from: "fulfilled", redemption: { ...r, cardIssued: true, updatedAt: now } }] });
}
