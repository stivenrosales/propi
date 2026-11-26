import { describe, expect, test } from "vitest";
import { signedAmount, type Actor, type PosInt } from "../src/index.ts";
import {
  REDEMPTION_EDGES,
  budgetSpent,
  decideRecordGiftCardIssued,
  decideRedeem,
  decideTransition,
  prepaidReserved,
  type Money,
  type Redeem,
  type RedeemSnapshot,
  type Redemption,
  type RedemptionTransition,
  type Reward,
  type ShopEvent,
  type TransitionRedemption,
} from "../src/shop/index.ts";
import { m, memberActor, record } from "./fixtures.ts";
import { NOW, ana, apiToken, base, redemption, reward, shopSettings, system } from "./shop.fixtures.ts";

const admin = memberActor("boss", "admin");
const approver = memberActor("rita", "approver");

const redeemCmd = (over: Partial<Redeem> = {}, k = "web:redeem:1"): Redeem => ({ type: "Redeem", ...base(k, memberActor("ana")), memberId: m("ana"), rewardId: "rw-1", variantId: null, ...over });
const snap = (over: Partial<RedeemSnapshot> = {}): RedeemSnapshot => ({
  member: ana,
  redeemable: 42,
  reward: reward(),
  settings: shopSettings(),
  budgetMonth: "2026-11",
  budgetSpent: 0,
  prepaidAvailable: null,
  redemptionId: "rd-1",
  ...over,
});
const transition = (t: RedemptionTransition, actor: Actor = approver, reason: string | null = null): TransitionRedemption => ({
  type: "TransitionRedemption",
  ...base(`redemption:rd-1:${t}`, actor),
  redemptionId: "rd-1",
  transition: t,
  reason,
});
const types = (events: readonly { type: string }[]) => events.map((e) => e.type);

describe("S50 redeem debits and reserves", () => {
  test("S50: 42 redeemable, reward cost 12 -> pending, 30 redeemable, one spend entry", () => {
    const d = decideRedeem(snap(), redeemCmd(), NOW);
    expect(d.outcome).toEqual({ ok: true, value: { redemptionId: "rd-1", state: "pending", cost: 12, redeemable: 30 } });
    expect(d.entries).toEqual([{ kind: "spend", amount: 12, memberId: "ana", counterpartId: null, cause: { type: "redemption", redemptionId: "rd-1" }, source: null, allowanceDay: null, reason: "Lunch voucher" }]);
    expect(types(d.events)).toEqual(["redemption.created"]);
  });

  test("S50: stock is reserved with a conditional decrement in the same decision", () => {
    const d = decideRedeem(snap({ reward: reward({ stock: 2 }) }), redeemCmd(), NOW);
    expect(d.writes[0]).toEqual({ t: "shop.stock.take", rewardId: "rw-1", variantId: null });
    expect(d.writes[1]).toMatchObject({ t: "shop.redemption.put", from: null, redemption: { stockReserved: true, state: "pending" } });
  });

  test("S35: a redemption can never make redeemable negative", () => {
    expect(decideRedeem(snap({ redeemable: 11 }), redeemCmd(), NOW).outcome).toEqual({ ok: false, error: { code: "insufficient_redeemable", cost: 12, redeemable: 11 } });
    expect(decideRedeem(snap({ redeemable: -4 }), redeemCmd(), NOW).entries).toEqual([]);
    expect(decideRedeem(snap({ redeemable: 12 }), redeemCmd(), NOW).outcome).toMatchObject({ ok: true, value: { redeemable: 0 } });
  });

  test("S50: inactive or unknown members cannot redeem", () => {
    expect(decideRedeem(snap({ member: record("ana", { active: false }) }), redeemCmd(), NOW).outcome).toEqual({ ok: false, error: { code: "inactive_member" } });
    expect(decideRedeem(snap({ member: null }), redeemCmd(), NOW).outcome).toEqual({ ok: false, error: { code: "unknown_member", memberId: "ana" } });
  });
});

describe("S45 S46 catalog checks at redemption", () => {
  test("S45: only active rewards can be redeemed", () => {
    for (const status of ["draft", "archived"] as const) {
      expect(decideRedeem(snap({ reward: reward({ status }) }), redeemCmd(), NOW).outcome).toEqual({ ok: false, error: { code: "reward_not_active" } });
    }
    expect(decideRedeem(snap({ reward: null }), redeemCmd(), NOW).outcome).toEqual({ ok: false, error: { code: "reward_not_found" } });
  });

  test("S46: stock 0 cannot be redeemed; variants carry their own stock", () => {
    expect(decideRedeem(snap({ reward: reward({ stock: 0 }) }), redeemCmd(), NOW).outcome).toEqual({ ok: false, error: { code: "out_of_stock" } });
    const v = reward({ variants: [{ id: "s", name: "S", stock: 0 }, { id: "l", name: "L", stock: 1 }] });
    expect(decideRedeem(snap({ reward: v }), redeemCmd({ variantId: "s" }), NOW).outcome).toEqual({ ok: false, error: { code: "out_of_stock" } });
    const ok = decideRedeem(snap({ reward: v }), redeemCmd({ variantId: "l" }), NOW);
    expect(ok.writes[0]).toEqual({ t: "shop.stock.take", rewardId: "rw-1", variantId: "l" });
    expect(decideRedeem(snap({ reward: v }), redeemCmd({ variantId: null }), NOW).outcome).toEqual({ ok: false, error: { code: "invalid_variant" } });
    expect(decideRedeem(snap({ reward: v }), redeemCmd({ variantId: "xl" }), NOW).outcome).toEqual({ ok: false, error: { code: "invalid_variant" } });
  });
});

describe("S47 monthly budget", () => {
  const budget = shopSettings({ monthlyBudget: { minor: 10000, currency: "PEN" } });

  test("S47: a redemption that would exceed the remaining budget is refused with what remains", () => {
    expect(decideRedeem(snap({ settings: budget, budgetSpent: 8000 }), redeemCmd(), NOW).outcome).toEqual({ ok: false, error: { code: "budget_exceeded", remaining: { minor: 2000, currency: "PEN" } } });
    const ok = decideRedeem(snap({ settings: budget, budgetSpent: 7500 }), redeemCmd(), NOW);
    expect(ok.outcome.ok).toBe(true);
    expect(ok.writes.at(-1)).toMatchObject({ redemption: { budgetMonth: "2026-11", internalCost: { minor: 2500, currency: "PEN" } } });
  });

  test("S47: budget spent counts held redemptions of the month only, in integer minor units", () => {
    const rs: Redemption[] = [
      redemption({ id: "a", budgetMonth: "2026-11", state: "pending" }),
      redemption({ id: "b", budgetMonth: "2026-11", state: "fulfilled" }),
      redemption({ id: "c", budgetMonth: "2026-11", state: "rejected" }),
      redemption({ id: "d", budgetMonth: "2026-10", state: "approved" }),
      redemption({ id: "e", budgetMonth: null, state: "approved" }),
    ];
    expect(budgetSpent(rs, "2026-11")).toBe(5000);
  });
});

describe("S52 S55 approval at creation", () => {
  test("S52: auto-approval globally or per reward moves pending straight to approved", () => {
    const global = decideRedeem(snap({ settings: shopSettings({ autoApprove: true }) }), redeemCmd(), NOW);
    expect(global.outcome).toMatchObject({ ok: true, value: { state: "approved" } });
    expect(types(global.events)).toEqual(["redemption.created", "redemption.approved"]);
    expect(decideRedeem(snap({ reward: reward({ autoApprove: true }) }), redeemCmd(), NOW).outcome).toMatchObject({ value: { state: "approved" } });
    expect(decideRedeem(snap({ settings: shopSettings({ autoApprove: true }), reward: reward({ autoApprove: false }) }), redeemCmd(), NOW).outcome).toMatchObject({ value: { state: "pending" } });
  });

  test("S55: an admin creates a manual redemption on behalf of a member; it debits the member", () => {
    const d = decideRedeem(snap(), redeemCmd({ actor: admin }), NOW);
    expect(d.outcome).toMatchObject({ ok: true, value: { state: "approved", redeemable: 30 } });
    expect(d.entries[0]).toMatchObject({ kind: "spend", memberId: "ana", amount: 12 });
    expect(d.writes.at(-1)).toMatchObject({ redemption: { onBehalfOf: { admin: "boss" } } });
    expect(decideRedeem(snap({ redeemable: 3 }), redeemCmd({ actor: admin }), NOW).outcome).toMatchObject({ ok: false, error: { code: "insufficient_redeemable" } });
  });

  test("S55: a member cannot redeem for someone else", () => {
    expect(decideRedeem(snap(), redeemCmd({ actor: memberActor("bob") }), NOW).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
  });
});

describe("S48 platform-agnostic redeem", () => {
  test("S48: the same Redeem command from chat and from web decides the same way", () => {
    const chat = decideRedeem(snap(), redeemCmd({}, "slack:redeem:T1:U1:view-9"), NOW);
    const web = decideRedeem(snap(), redeemCmd({}, "web:redeem:sess-3"), NOW);
    expect(chat).toEqual(web);
  });
});

describe("S49 S51 S53 S54 transitions", () => {
  const pending = redemption({ stockReserved: true });
  const decide = (r: Redemption | null, t: RedemptionTransition, actor: Actor = approver) =>
    decideTransition({ redemption: r, collab: null, contributions: new Map() }, transition(t, actor, "no stock left"), NOW);

  test("S49: REDEMPTION_EDGES are exactly the statechart's edges", () => {
    expect(REDEMPTION_EDGES).toEqual({ pending: ["approved", "rejected"], approved: ["fulfilled", "cancelled"], fulfilled: [], rejected: [], cancelled: [] });
  });

  test("S49: every transition outside the edges is refused", () => {
    const all: RedemptionTransition[] = ["approve", "reject", "cancel", "fulfil"];
    const legal = { pending: ["approve", "reject"], approved: ["fulfil", "cancel"], fulfilled: ["fulfil"], rejected: [], cancelled: [] } as const;
    for (const state of ["pending", "approved", "fulfilled", "rejected", "cancelled"] as const) {
      for (const t of all) {
        const d = decide(redemption({ state }), t, admin);
        expect(d.outcome.ok, `${state} --${t}`).toBe((legal[state] as readonly string[]).includes(t));
        if (!d.outcome.ok) expect(d.outcome.error).toEqual({ code: "illegal_transition", from: state, transition: t });
      }
    }
  });

  test("S51: rejection refunds the full cost and releases stock in the same decision", () => {
    const d = decide(pending, "reject");
    expect(d.outcome).toEqual({ ok: true, value: { redemptionId: "rd-1", state: "rejected", changed: true, refunded: 12 } });
    expect(d.entries).toEqual([{ kind: "refund", amount: 12, memberId: "ana", counterpartId: null, cause: { type: "redemption", redemptionId: "rd-1" }, source: null, allowanceDay: null, reason: "no stock left" }]);
    expect(d.writes).toEqual([
      { t: "shop.redemption.put", from: "pending", redemption: { ...pending, state: "rejected", updatedAt: NOW, reason: "no stock left" } },
      { t: "shop.stock.add", rewardId: "rw-1", variantId: null, quantity: 1 },
    ]);
  });

  test("S51: cancelling an approved redemption refunds and releases stock; only admins cancel", () => {
    const approved = { ...pending, state: "approved" as const };
    const d = decide(approved, "cancel", admin);
    expect(d.outcome).toMatchObject({ ok: true, value: { state: "cancelled", refunded: 12 } });
    expect(d.writes).toContainEqual({ t: "shop.stock.add", rewardId: "rw-1", variantId: null, quantity: 1 });
    expect(decide(approved, "cancel", approver).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
  });

  test("S53: fulfil by an approver or an external system (API); fulfilling again is a no-op", () => {
    const approved = redemption({ state: "approved" });
    expect(decide(approved, "fulfil").outcome).toEqual({ ok: true, value: { redemptionId: "rd-1", state: "fulfilled", changed: true, refunded: 0 } });
    expect(decide(approved, "fulfil", apiToken(["redemptions:write"])).outcome.ok).toBe(true);
    const again = decide(redemption({ state: "fulfilled" }), "fulfil", apiToken(["redemptions:write"]));
    expect(again).toEqual({ outcome: { ok: true, value: { redemptionId: "rd-1", state: "fulfilled", changed: false, refunded: 0 } }, entries: [], writes: [], events: [] });
    expect(decide(approved, "fulfil", apiToken(["rewards:write"])).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "approver" } });
    expect(decide(approved, "fulfil", memberActor("ana")).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "approver" } });
  });

  test("S54: every state change emits its event and notifies the member", () => {
    const ev = (r: Redemption, t: RedemptionTransition) => decide(r, t, admin).events as ShopEvent[];
    expect(ev(redemption(), "approve")).toEqual([{ type: "redemption.approved", redemptionId: "rd-1", rewardId: "rw-1", collabId: null, cost: 12, quantity: 1, notify: ["ana"] }]);
    expect(types(ev(redemption(), "reject"))).toEqual(["redemption.rejected"]);
    expect(types(ev(redemption({ state: "approved" }), "cancel"))).toEqual(["redemption.cancelled"]);
    expect(types(ev(redemption({ state: "approved" }), "fulfil"))).toEqual(["redemption.fulfilled"]);
    expect(types(decideRedeem(snap(), redeemCmd(), NOW).events)).toEqual(["redemption.created"]);
  });

  test("S49: an unknown redemption is reported", () => {
    expect(decide(null, "approve").outcome).toEqual({ ok: false, error: { code: "redemption_not_found" } });
  });
});

describe("S108 gift cards", () => {
  const card = reward({ giftCard: true, internalCost: { minor: 5000, currency: "PEN" } });
  const pen = (minor: number): Money => ({ minor, currency: "PEN" });

  test("S108: a gift-card redemption is refused when the prepaid balance is short", () => {
    expect(decideRedeem(snap({ reward: card, prepaidAvailable: pen(4999) }), redeemCmd(), NOW).outcome).toEqual({ ok: false, error: { code: "prepaid_insufficient", available: pen(4999) } });
    expect(decideRedeem(snap({ reward: card, prepaidAvailable: null }), redeemCmd(), NOW).outcome).toEqual({ ok: false, error: { code: "prepaid_insufficient", available: pen(0) } });
    expect(decideRedeem(snap({ reward: card, prepaidAvailable: pen(5000) }), redeemCmd(), NOW).outcome).toMatchObject({ ok: true, value: { state: "pending" } });
  });

  test("S108: a gift card is fulfilled automatically on approval (manual or automatic)", () => {
    const auto = decideRedeem(snap({ reward: { ...card, autoApprove: true }, prepaidAvailable: pen(9000) }), redeemCmd(), NOW);
    expect(auto.outcome).toMatchObject({ ok: true, value: { state: "fulfilled" } });
    expect(types(auto.events)).toEqual(["redemption.created", "redemption.approved", "redemption.fulfilled"]);
    const approve = decideTransition({ redemption: redemption({ giftCard: true }), collab: null, contributions: new Map() }, transition("approve"), NOW);
    expect(approve.outcome).toMatchObject({ ok: true, value: { state: "fulfilled" } });
    expect(types(approve.events)).toEqual(["redemption.approved", "redemption.fulfilled"]);
  });

  test("S108: held gift cards not yet issued reserve the prepaid balance; issuing is recorded once", () => {
    const rs = [
      redemption({ id: "a", giftCard: true, state: "pending" }),
      redemption({ id: "b", giftCard: true, state: "fulfilled", cardIssued: true }),
      redemption({ id: "c", giftCard: true, state: "rejected" }),
      redemption({ id: "d", giftCard: false, state: "pending" }),
    ];
    expect(prepaidReserved(rs)).toBe(2500);
    const r = redemption({ giftCard: true, state: "fulfilled" });
    const rec = (x: Redemption) => decideRecordGiftCardIssued({ redemption: x }, { type: "RecordGiftCardIssued", ...base("giftcard:rd-1:issued", system), redemptionId: "rd-1" }, NOW);
    expect(rec(r).writes).toEqual([{ t: "shop.redemption.put", from: "fulfilled", redemption: { ...r, cardIssued: true, updatedAt: NOW } }]);
    expect(rec({ ...r, cardIssued: true }).writes).toEqual([]);
    expect(rec({ ...r, state: "pending" }).outcome).toEqual({ ok: false, error: { code: "illegal_transition", from: "pending", transition: "fulfil" } });
  });
});

/**
 * Redemption.tla, checked by exhaustive exploration of the deciders: every sequence of
 * actions from every start, with auto-approval on and off and stock 0 or 1.
 */
describe("Redemption.tla invariants over the deciders", () => {
  interface World {
    redeemable: number;
    stock: number;
    r: Redemption | null;
    debits: number;
    refunds: number;
    webhooks: number;
  }
  const COST = 12;
  const actions = ["redeem", "approve", "reject", "cancel", "fulfil"] as const;

  function step(w: World, a: (typeof actions)[number], autoApprove: boolean): World {
    const d =
      a === "redeem"
        ? w.r !== null
          ? null
          : decideRedeem(snap({ redeemable: w.redeemable, reward: reward({ stock: w.stock, cost: COST as PosInt, autoApprove }) }), redeemCmd(), NOW)
        : decideTransition({ redemption: w.r, collab: null, contributions: new Map() }, transition(a, admin), NOW);
    if (d === null || !d.outcome.ok) return w;
    const next = { ...w };
    for (const e of d.entries) {
      next.redeemable += signedAmount(e);
      if (e.kind === "spend") next.debits++;
      if (e.kind === "refund") next.refunds++;
    }
    for (const wr of d.writes) {
      if (wr.t === "shop.stock.take") next.stock--;
      if (wr.t === "shop.stock.add") next.stock += wr.quantity;
      if (wr.t === "shop.redemption.put") {
        expect(wr.from).toBe(w.r?.state ?? null); // CAS from the state we read
        next.r = wr.redemption;
      }
    }
    next.webhooks += d.events.filter((e) => e.type.startsWith("redemption.")).length;
    return next;
  }

  test("BalanceNeverNegative, UnitsConserved, AtMostOneRefund, RefundIffRejectedOrCancelled, StockConserved, EveryChangeNotified", () => {
    let checked = 0;
    for (const start of [0, 11, 12, 30]) {
      for (const initStock of [0, 1]) {
        for (const autoApprove of [false, true]) {
          const explore = (w: World, depth: number) => {
            const state = w.r?.state ?? "none";
            const held = state === "pending" || state === "approved" || state === "fulfilled";
            expect(w.redeemable).toBeGreaterThanOrEqual(0);
            expect(w.redeemable).toBe(start - COST * w.debits + COST * w.refunds);
            expect(w.refunds).toBeLessThanOrEqual(1);
            expect(w.refunds === 1).toBe(state === "rejected" || state === "cancelled");
            expect(w.stock + (held ? 1 : 0)).toBe(initStock);
            expect(w.webhooks).toBeGreaterThanOrEqual(state === "none" ? 0 : 1);
            checked++;
            if (depth === 0) return;
            for (const a of actions) explore(step(w, a, autoApprove), depth - 1);
          };
          explore({ redeemable: start, stock: initStock, r: null, debits: 0, refunds: 0, webhooks: 0 }, 4);
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("S2 batch redemption: one redemption carries a quantity", () => {
  const qty = (quantity: number, over: Partial<Redeem> = {}) => redeemCmd({ quantity, ...over } as Partial<Redeem>);

  test("S2: cost = unit cost x quantity, one spend entry, one redemption that carries the quantity", () => {
    const d = decideRedeem(snap(), qty(3), NOW);
    expect(d.outcome).toEqual({ ok: true, value: { redemptionId: "rd-1", state: "pending", cost: 36, redeemable: 6 } });
    expect(d.entries).toEqual([{ kind: "spend", amount: 36, memberId: "ana", counterpartId: null, cause: { type: "redemption", redemptionId: "rd-1" }, source: null, allowanceDay: null, reason: "Lunch voucher" }]);
    expect(d.writes.at(-1)).toMatchObject({ t: "shop.redemption.put", redemption: { quantity: 3, cost: 36, internalCost: { minor: 7500, currency: "PEN" } } });
  });

  test("S2: insufficient balance for N units is refused with the total cost", () => {
    expect(decideRedeem(snap(), qty(4), NOW).outcome).toEqual({ ok: false, error: { code: "insufficient_redeemable", cost: 48, redeemable: 42 } });
  });

  test("S2: stock below N is refused with what is left; stock N is taken in one conditional decrement", () => {
    expect(decideRedeem(snap({ reward: reward({ stock: 2 }) }), qty(3), NOW).outcome).toEqual({ ok: false, error: { code: "out_of_stock", available: 2 } });
    const ok = decideRedeem(snap({ reward: reward({ stock: 3 }) }), qty(3), NOW);
    expect(ok.writes[0]).toEqual({ t: "shop.stock.take", rewardId: "rw-1", variantId: null, quantity: 3 });
  });

  test("S2: the monthly budget counts the internal cost of all N units", () => {
    const budget = shopSettings({ monthlyBudget: { minor: 10000, currency: "PEN" } });
    expect(decideRedeem(snap({ settings: budget, budgetSpent: 3000 }), qty(3), NOW).outcome).toEqual({ ok: false, error: { code: "budget_exceeded", remaining: { minor: 7000, currency: "PEN" } } });
    const ok = decideRedeem(snap({ settings: budget, budgetSpent: 2500 }), qty(3), NOW);
    expect(ok.outcome.ok).toBe(true);
    expect(budgetSpent([(ok.writes.at(-1) as { redemption: Redemption }).redemption], "2026-11")).toBe(7500);
  });

  test("S2: the Free plan limit (plan_limit) still applies to a batch", () => {
    expect(decideRedeem(snap({ plan: { overLimit: true, limit: 10, activeMembers: 11 } as never }), qty(2), NOW).outcome).toEqual({ ok: false, error: { code: "plan_limit", limit: 10, activeMembers: 11 } });
  });

  test("S2: a quantity that is not a positive integer is refused", () => {
    for (const n of [0, -1, 1.5, Number.NaN]) expect(decideRedeem(snap(), qty(n), NOW).outcome).toEqual({ ok: false, error: { code: "invalid_quantity" } });
  });

  test("S2: a Redeem without quantity (old clients) is one unit, exactly as before", () => {
    const before = decideRedeem(snap({ reward: reward({ stock: 2 }) }), redeemCmd(), NOW);
    expect(before.outcome).toEqual({ ok: true, value: { redemptionId: "rd-1", state: "pending", cost: 12, redeemable: 30 } });
    expect(before.writes[0]).toEqual({ t: "shop.stock.take", rewardId: "rw-1", variantId: null });
    expect(before.writes[1]).toMatchObject({ redemption: { quantity: 1, cost: 12 } });
    expect(decideRedeem(snap({ reward: reward({ stock: 2 }) }), qty(1), NOW)).toEqual(before);
  });

  test("S2: events carry the quantity; rows without one read as 1", () => {
    const d = decideRedeem(snap(), qty(3), NOW);
    expect(d.events[0]).toEqual({ type: "redemption.created", redemptionId: "rd-1", rewardId: "rw-1", collabId: null, cost: 36, quantity: 3, notify: ["ana"] });
    const old = decideTransition({ redemption: redemption(), collab: null, contributions: new Map() }, transition("approve", admin), NOW);
    expect(old.events[0]).toMatchObject({ type: "redemption.approved", quantity: 1 });
  });

  test("S2: reject and cancel refund cost x N and release N stock units", () => {
    const held = redemption({ quantity: 3, cost: 36 as PosInt, stockReserved: true } as Partial<Redemption>);
    const rejected = decideTransition({ redemption: held, collab: null, contributions: new Map() }, transition("reject"), NOW);
    expect(rejected.outcome).toMatchObject({ ok: true, value: { state: "rejected", refunded: 36 } });
    expect(rejected.writes).toContainEqual({ t: "shop.stock.add", rewardId: "rw-1", variantId: null, quantity: 3 });
    const cancelled = decideTransition({ redemption: { ...held, state: "approved" }, collab: null, contributions: new Map() }, transition("cancel", admin), NOW);
    expect(cancelled.entries).toEqual([expect.objectContaining({ kind: "refund", amount: 36, memberId: "ana" })]);
    expect(cancelled.writes).toContainEqual({ t: "shop.stock.add", rewardId: "rw-1", variantId: null, quantity: 3 });
  });
});
