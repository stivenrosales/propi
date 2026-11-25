// Pure shop helpers: permissions, decision constructors, folds used by stores and deciders.
import type { NewEntry } from "../ledger/entries.ts";
import type { Actor, MemberId, PosInt } from "../shared/types.ts";
import { localMonth } from "../workspace/time.ts";
import type { Instant } from "../shared/types.ts";
import {
  HELD_STATES,
  REDEMPTION_EDGES,
  TRANSITION_TARGET,
  type Money,
  type Redemption,
  type RedemptionState,
  type RedemptionTransition,
  type ShopDecision,
  type ShopError,
  type ShopEvent,
  type ShopFailure,
  type ShopWrite,
} from "./types.ts";
import type { DomainEvent } from "../shared/decision.ts";

export function shopAccept<T>(value: T, parts: { entries?: readonly NewEntry[]; writes?: readonly ShopWrite[]; events?: readonly (DomainEvent | ShopEvent)[] } = {}): ShopDecision<T> {
  return { outcome: { ok: true, value }, entries: parts.entries ?? [], writes: parts.writes ?? [], events: parts.events ?? [] };
}

export function shopReject<T = never>(error: ShopFailure): ShopDecision<T> {
  return { outcome: { ok: false, error } as { ok: false; error: ShopError }, entries: [], writes: [], events: [] };
}

/** S44: admins and API tokens with rewards:write manage the catalog; system jobs too. */
export function canManageShop(actor: Actor): boolean {
  switch (actor.kind) {
    case "member":
      return actor.role === "admin";
    case "apiToken":
      return actor.scopes.includes("rewards:write");
    case "system":
      return true;
    case "bot":
      return false;
  }
}

/** S6, S53, S97: approvers review; the API and system jobs drive transitions too. Cancel is admin-only. */
export function canTransition(actor: Actor, t: RedemptionTransition): boolean {
  switch (actor.kind) {
    case "member":
      return t === "cancel" ? actor.role === "admin" : actor.role === "admin" || actor.role === "approver";
    case "apiToken":
      return actor.scopes.includes("redemptions:write");
    case "system":
      return true;
    case "bot":
      return false;
  }
}

/** S49: the state a transition leads to, or null when the edge does not exist. */
export function nextState(from: RedemptionState, t: RedemptionTransition): RedemptionState | null {
  const to = TRANSITION_TARGET[t];
  return (REDEMPTION_EDGES[from] as readonly RedemptionState[]).includes(to) ? to : null;
}

export const isHeld = (s: RedemptionState): boolean => HELD_STATES.includes(s);

/** S47: budget months follow the workspace timezone (S3). */
export const budgetMonth = (at: Instant, tz: string): string => localMonth(at, tz);

/** S47: internal cost (minor units) of held redemptions in `month`. */
export function budgetSpent(redemptions: Iterable<Redemption>, month: string): number {
  let spent = 0;
  for (const r of redemptions) if (r.budgetMonth === month && isHeld(r.state) && r.internalCost !== null) spent += r.internalCost.minor;
  return spent;
}

/** S108: what held gift-card redemptions not yet issued reserve from the prepaid balance. */
export function prepaidReserved(redemptions: Iterable<Redemption>): number {
  let reserved = 0;
  for (const r of redemptions) if (r.giftCard && !r.cardIssued && isHeld(r.state) && r.internalCost !== null) reserved += r.internalCost.minor;
  return reserved;
}

export const isMoney = (m: Money): boolean => Number.isSafeInteger(m.minor) && m.minor >= 0 && /^[A-Z]{3}$/.test(m.currency);

export function shopEntry(kind: "spend" | "refund", memberId: MemberId, amount: PosInt, cause: NewEntry["cause"], reason: string | null): NewEntry {
  return { kind, amount, memberId, counterpartId: null, cause, source: null, allowanceDay: null, reason };
}

export const sortedIds = (ids: Iterable<MemberId>): MemberId[] => [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
