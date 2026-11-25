// S56-S59: collaborative rewards as pure deciders. Docs: docs/statecharts/collab.
import { isEntryAmount, isPosInt, type Instant, type MemberId, type PosInt } from "../shared/types.ts";
import type { MemberRecord } from "../members/members.ts";
import { collabRefunds, redemptionEvent } from "./redemptions.ts";
import { canManageShop, shopAccept, shopEntry, shopReject, sortedIds } from "./rules.ts";
import type { CloseCollab, Collab, CollabId, Contribute, CreateCollab, Redemption, RedemptionId, ShopDecision, ShopEvent, ShopResults } from "./types.ts";

export function decideCreateCollab(s: { readonly collabId: CollabId }, cmd: CreateCollab, now: Instant): ShopDecision<ShopResults["CreateCollab"]> {
  if (!canManageShop(cmd.actor)) return shopReject({ code: "forbidden", need: "rewards:write" });
  if (cmd.title.trim() === "") return shopReject({ code: "invalid_reward", field: "title" });
  if (!isEntryAmount(cmd.goal)) return shopReject({ code: "invalid_reward", field: "goal" }); // refunds stay within one entry
  const collab: Collab = {
    id: s.collabId,
    title: cmd.title.trim(),
    description: cmd.description,
    goal: cmd.goal,
    deadline: cmd.deadline,
    autoApprove: cmd.autoApprove,
    phase: "open",
    redemptionId: null,
    createdAt: now,
  };
  return shopAccept({ collabId: collab.id }, { writes: [{ t: "shop.collab.put", from: null, collab }] });
}

/** S56: progress is the sum of what contributors still hold in the collab. */
export const raisedOf = (contributions: ReadonlyMap<MemberId, number>): number => [...contributions.values()].reduce((t, n) => t + Math.max(0, n), 0);

const isOpen = (c: Collab, now: Instant): boolean => c.phase === "open" && (c.deadline === null || now < c.deadline);

export interface ContributeSnapshot {
  readonly member: MemberRecord | null;
  readonly redeemable: number;
  readonly collab: Collab | null;
  readonly contributions: ReadonlyMap<MemberId, number>;
  /** Used only when this contribution reaches the goal (S57). */
  readonly redemptionId: RedemptionId;
}

/**
 * S56: a contribution is a spend of redeemable units (S35: never below zero).
 * S59: capped at goal - raised. S57: the contribution that reaches the goal creates the single
 * group redemption in the same decision.
 */
export function decideContribute(s: ContributeSnapshot, cmd: Contribute, now: Instant): ShopDecision<ShopResults["Contribute"]> {
  if (cmd.actor.kind !== "member" || cmd.actor.memberId !== cmd.memberId) return shopReject({ code: "forbidden", need: "member" });
  if (!isPosInt(cmd.amount)) return shopReject({ code: "invalid_amount" });
  if (s.member === null) return shopReject({ code: "unknown_member", memberId: cmd.memberId });
  if (!s.member.active) return shopReject({ code: "inactive_member" });
  const c = s.collab;
  if (c === null) return shopReject({ code: "collab_not_found" });
  if (!isOpen(c, now)) return shopReject({ code: "collab_closed" });
  const raised = raisedOf(s.contributions);
  const take = Math.min(cmd.amount, c.goal - raised);
  if (!isPosInt(take)) return shopReject({ code: "collab_closed" });
  if (s.redeemable < take) return shopReject({ code: "insufficient_redeemable", cost: take, redeemable: s.redeemable });

  const after = raised + take;
  const events: ShopEvent[] = [{ type: "collab.contributed", collabId: c.id, memberId: cmd.memberId, amount: take, raised: after, goal: c.goal }];
  const entry = shopEntry("spend", cmd.memberId, take as PosInt, { type: "contribution", collabId: c.id }, c.title);
  if (after < c.goal) return shopAccept({ collabId: c.id, taken: take, raised: after, goal: c.goal, redemptionId: null }, { entries: [entry], events });

  const contributors = new Map(s.contributions);
  contributors.set(cmd.memberId, (contributors.get(cmd.memberId) ?? 0) + take);
  const notify = sortedIds([...contributors].filter(([, n]) => n > 0).map(([m]) => m));
  const redemption: Redemption = {
    id: s.redemptionId,
    memberId: null,
    rewardId: null,
    variantId: null,
    collabId: c.id,
    cost: c.goal,
    internalCost: null,
    budgetMonth: null,
    stockReserved: false,
    giftCard: false,
    cardIssued: false,
    onBehalfOf: { collab: c.id },
    state: c.autoApprove ? "approved" : "pending",
    createdAt: now,
    updatedAt: now,
    reason: null,
  };
  events.push({ type: "collab.completed", collabId: c.id, redemptionId: redemption.id, notify });
  events.push(redemptionEvent("redemption.created", redemption, notify));
  if (c.autoApprove) events.push(redemptionEvent("redemption.approved", redemption, notify));
  return shopAccept(
    { collabId: c.id, taken: take, raised: after, goal: c.goal, redemptionId: redemption.id },
    {
      entries: [entry],
      writes: [
        { t: "shop.collab.put", from: "open", collab: { ...c, phase: "completed", redemptionId: redemption.id } },
        { t: "shop.redemption.put", from: null, redemption },
      ],
      events,
    },
  );
}

/** S58: archived, or past its deadline, before the goal: every contribution goes back. */
export function decideCloseCollab(s: { readonly collab: Collab | null; readonly contributions: ReadonlyMap<MemberId, number> }, cmd: CloseCollab, now: Instant): ShopDecision<ShopResults["CloseCollab"]> {
  if (!canManageShop(cmd.actor)) return shopReject({ code: "forbidden", need: "rewards:write" });
  const c = s.collab;
  if (c === null) return shopReject({ code: "collab_not_found" });
  if (c.phase !== "open") return shopReject({ code: "collab_closed" });
  if (cmd.why === "deadline" && (c.deadline === null || now < c.deadline)) return shopReject({ code: "deadline_not_reached" });
  const entries = collabRefunds(c.id, s.contributions, cmd.why);
  const total = entries.reduce((t, e) => t + e.amount, 0);
  const notify = entries.map((e) => e.memberId);
  return shopAccept(
    { collabId: c.id, members: entries.length, refunded: total },
    {
      entries,
      writes: [{ t: "shop.collab.put", from: "open", collab: { ...c, phase: "refunded" } }],
      events: [{ type: "collab.refunded", collabId: c.id, why: cmd.why, notify, total }],
    },
  );
}
