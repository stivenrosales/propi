// S31-S34: balances are folds over the ledger. Nothing derived is stored.
import type { GiftId, LocalDate, MemberId } from "../shared/types.ts";
import { EFFECTS, signedAmount, type NewEntry } from "./entries.ts";

export interface Balances {
  readonly received: number; // S31
  readonly given: number; // S33
  readonly redeemable: number; // S32
}

type Mutable = { received: number; given: number; redeemable: number };

/** Rebuild every member's balances from the entries (S34). Order-independent. */
export function replay(entries: Iterable<NewEntry>): Map<MemberId, Balances> {
  const out = new Map<MemberId, Mutable>();
  const get = (m: MemberId) => {
    let b = out.get(m);
    if (!b) {
      b = { received: 0, given: 0, redeemable: 0 };
      out.set(m, b);
    }
    return b;
  };
  for (const e of entries) {
    const fx = EFFECTS[e.kind];
    const amount = signedAmount(e);
    if (fx.redeemable) get(e.memberId).redeemable += amount;
    if (fx.received) get(e.memberId).received += amount;
    if (fx.given && e.counterpartId !== null) get(e.counterpartId).given += amount;
  }
  return out;
}

export const ZERO_BALANCES: Balances = { received: 0, given: 0, redeemable: 0 };

/** S19, S21, S27: units the giver used on `day`, net of reversals that gave that day back. */
export function allowanceUsed(entries: Iterable<NewEntry>, giver: MemberId, day: LocalDate): number {
  let used = 0;
  for (const e of entries) {
    if (e.counterpartId === giver && e.allowanceDay === day && (e.kind === "gift" || e.kind === "gift_reversal")) used += signedAmount(e);
  }
  return used;
}

/** Net units each receiver still holds from one gift (gifts minus reversals). */
export function netPerReceiver(entries: Iterable<NewEntry>, giftId: GiftId): Map<MemberId, number> {
  const out = new Map<MemberId, number>();
  for (const e of entries) {
    if (e.cause.type !== "gift" || e.cause.giftId !== giftId) continue;
    if (e.kind !== "gift" && e.kind !== "gift_reversal") continue;
    out.set(e.memberId, (out.get(e.memberId) ?? 0) + signedAmount(e));
  }
  return out;
}
