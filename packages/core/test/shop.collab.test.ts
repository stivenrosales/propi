import { describe, expect, test } from "vitest";
import { signedAmount, type Actor, type Instant, type MemberId, type PosInt } from "../src/index.ts";
import {
  decideCloseCollab,
  decideContribute,
  decideCreateCollab,
  decideTransition,
  raisedOf,
  type Collab,
  type Contribute,
  type ContributeSnapshot,
  type Redemption,
  type RedemptionTransition,
} from "../src/shop/index.ts";
import { m, memberActor, record } from "./fixtures.ts";
import { NOW, base, contributions, redemption, system } from "./shop.fixtures.ts";

const admin = memberActor("boss", "admin");
const collab = (over: Partial<Collab> = {}): Collab => ({
  id: "cb-1",
  title: "Team dinner",
  description: "",
  goal: 10 as PosInt,
  deadline: null,
  autoApprove: false,
  phase: "open",
  redemptionId: null,
  createdAt: 0 as Instant,
  ...over,
});
const contribute = (who: string, amount: number): Contribute => ({ type: "Contribute", ...base(`web:contrib:${who}:${amount}`, memberActor(who)), collabId: "cb-1", memberId: m(who), amount });
const snap = (over: Partial<ContributeSnapshot> = {}): ContributeSnapshot => ({
  member: record("ana"),
  redeemable: 20,
  collab: collab(),
  contributions: new Map(),
  redemptionId: "rd-g",
  ...over,
});
const close = (why: "archived" | "deadline", actor: Actor = admin) => ({ type: "CloseCollab", ...base(`collab:cb-1:refund`, actor), collabId: "cb-1", why }) as const;

describe("S56 contributions", () => {
  test("S56: a contribution spends redeemable units and reports progress to all", () => {
    const d = decideContribute(snap({ contributions: contributions([["bob", 3]]) }), contribute("ana", 4), NOW);
    expect(d.outcome).toEqual({ ok: true, value: { collabId: "cb-1", taken: 4, raised: 7, goal: 10, redemptionId: null } });
    expect(d.entries).toEqual([{ kind: "spend", amount: 4, memberId: "ana", counterpartId: null, cause: { type: "contribution", collabId: "cb-1" }, source: null, allowanceDay: null, reason: "Team dinner" }]);
    expect(d.events).toEqual([{ type: "collab.contributed", collabId: "cb-1", memberId: "ana", amount: 4, raised: 7, goal: 10 }]);
    expect(d.writes).toEqual([]);
  });

  test("S35: a contribution never drives redeemable negative", () => {
    expect(decideContribute(snap({ redeemable: 3 }), contribute("ana", 4), NOW).outcome).toEqual({ ok: false, error: { code: "insufficient_redeemable", cost: 4, redeemable: 3 } });
  });

  test("S56: members contribute for themselves only, with a positive integer", () => {
    expect(decideContribute(snap(), { ...contribute("ana", 2), actor: memberActor("bob") }, NOW).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "member" } });
    expect(decideContribute(snap(), contribute("ana", 0), NOW).outcome).toEqual({ ok: false, error: { code: "invalid_amount" } });
    expect(decideContribute(snap({ member: record("ana", { active: false }) }), contribute("ana", 2), NOW).outcome).toEqual({ ok: false, error: { code: "inactive_member" } });
  });

  test("S56: an admin creates a collaborative reward with a goal in units", () => {
    const d = decideCreateCollab({ collabId: "cb-1" }, { type: "CreateCollab", ...base("web:collab", admin), title: "Team dinner", description: "", goal: 10, deadline: null, autoApprove: false }, NOW);
    expect(d.writes).toEqual([{ t: "shop.collab.put", from: null, collab: collab({ createdAt: NOW }) }]);
    expect(decideCreateCollab({ collabId: "x" }, { type: "CreateCollab", ...base("web:collab", admin), title: "x", description: "", goal: 0, deadline: null, autoApprove: false }, NOW).outcome).toEqual({ ok: false, error: { code: "invalid_reward", field: "goal" } });
  });
});

describe("S59 cap at the goal", () => {
  test("S59: a contribution that would overshoot is capped at goal - raised", () => {
    const d = decideContribute(snap({ contributions: contributions([["bob", 8]]) }), contribute("ana", 5), NOW);
    expect(d.outcome).toMatchObject({ ok: true, value: { taken: 2, raised: 10 } });
    expect(d.entries.map((e) => e.amount)).toEqual([2]);
  });
});

describe("S57 one group redemption", () => {
  test("S57: reaching the goal creates a single redemption on behalf of the contributors, who are notified", () => {
    const d = decideContribute(snap({ contributions: contributions([["bob", 6]]) }), contribute("ana", 4), NOW);
    expect(d.outcome).toEqual({ ok: true, value: { collabId: "cb-1", taken: 4, raised: 10, goal: 10, redemptionId: "rd-g" } });
    expect(d.entries).toHaveLength(1); // no extra debit for the redemption
    expect(d.writes).toEqual([
      { t: "shop.collab.put", from: "open", collab: collab({ phase: "completed", redemptionId: "rd-g" }) },
      { t: "shop.redemption.put", from: null, redemption: expect.objectContaining({ id: "rd-g", memberId: null, collabId: "cb-1", cost: 10, state: "pending", onBehalfOf: { collab: "cb-1" } }) },
    ]);
    expect(d.events.map((e) => e.type)).toEqual(["collab.contributed", "collab.completed", "redemption.created"]);
    expect(d.events[1]).toEqual({ type: "collab.completed", collabId: "cb-1", redemptionId: "rd-g", notify: ["ana", "bob"] });
  });

  test("S57: a completed collab takes no more contributions", () => {
    expect(decideContribute(snap({ collab: collab({ phase: "completed" }) }), contribute("ana", 1), NOW).outcome).toEqual({ ok: false, error: { code: "collab_closed" } });
  });
});

describe("S58 refund-all", () => {
  const held = contributions([["ana", 3], ["bob", 4]]);

  test("S58: archiving before the goal refunds every contribution", () => {
    const d = decideCloseCollab({ collab: collab(), contributions: held }, close("archived"), NOW);
    expect(d.outcome).toEqual({ ok: true, value: { collabId: "cb-1", members: 2, refunded: 7 } });
    expect(d.entries.map((e) => [e.kind, e.memberId, e.amount, e.cause])).toEqual([
      ["refund", "ana", 3, { type: "contribution", collabId: "cb-1" }],
      ["refund", "bob", 4, { type: "contribution", collabId: "cb-1" }],
    ]);
    expect(d.writes).toEqual([{ t: "shop.collab.put", from: "open", collab: collab({ phase: "refunded" }) }]);
    expect(d.events).toEqual([{ type: "collab.refunded", collabId: "cb-1", why: "archived", notify: ["ana", "bob"], total: 7 }]);
  });

  test("S58: the deadline closes it only once it has passed; contributions after it are refused", () => {
    const due = collab({ deadline: NOW });
    expect(decideCloseCollab({ collab: collab({ deadline: (NOW + 1) as Instant }), contributions: held }, close("deadline", system), NOW).outcome).toEqual({ ok: false, error: { code: "deadline_not_reached" } });
    expect(decideCloseCollab({ collab: due, contributions: held }, close("deadline", system), NOW).outcome).toMatchObject({ ok: true, value: { refunded: 7 } });
    expect(decideContribute(snap({ collab: due }), contribute("ana", 1), NOW).outcome).toEqual({ ok: false, error: { code: "collab_closed" } });
  });

  test("S58: rejecting the group redemption refunds every contributor and closes the collab", () => {
    const group = redemption({ id: "rd-g", memberId: null, rewardId: null, collabId: "cb-1", cost: 7 as PosInt, onBehalfOf: { collab: "cb-1" } });
    const d = decideTransition({ redemption: group, collab: collab({ phase: "completed", redemptionId: "rd-g" }), contributions: held }, { type: "TransitionRedemption", ...base("redemption:rd-g:reject", admin), redemptionId: "rd-g", transition: "reject", reason: "venue closed" }, NOW);
    expect(d.outcome).toMatchObject({ ok: true, value: { state: "rejected", refunded: 7 } });
    expect(d.entries.map((e) => [e.kind, e.memberId, e.amount])).toEqual([["refund", "ana", 3], ["refund", "bob", 4]]);
    expect(d.writes).toContainEqual({ t: "shop.collab.put", from: "completed", collab: collab({ phase: "refunded", redemptionId: "rd-g" }) });
    expect(d.events.map((e) => e.type)).toEqual(["redemption.rejected", "collab.refunded"]);
  });

  test("S58: a closed collab cannot be closed again", () => {
    expect(decideCloseCollab({ collab: collab({ phase: "refunded" }), contributions: new Map() }, close("archived"), NOW).outcome).toEqual({ ok: false, error: { code: "collab_closed" } });
  });
});

/** Collab.tla: members {a, b}, goal 3, wallet 2, explored exhaustively through the deciders. */
describe("Collab.tla invariants over the deciders", () => {
  const GOAL = 3;
  const WALLET = 2;
  const members = [m("a"), m("b")];
  interface World {
    bal: Map<MemberId, number>;
    contrib: Map<MemberId, number>;
    collab: Collab;
    redemption: Redemption | null;
    redemptions: number;
  }
  type Action = { kind: "contribute"; who: MemberId; k: number } | { kind: "close" } | { kind: "transition"; t: RedemptionTransition };
  const ACTIONS: Action[] = [
    ...members.flatMap((who) => [1, 2].map((k): Action => ({ kind: "contribute", who, k }))),
    { kind: "close" },
    { kind: "transition", t: "reject" },
    { kind: "transition", t: "approve" },
    { kind: "transition", t: "fulfil" },
  ];

  function step(w: World, a: Action): World {
    const d =
      a.kind === "contribute"
        ? decideContribute({ member: record(a.who), redeemable: w.bal.get(a.who) ?? 0, collab: w.collab, contributions: w.contrib, redemptionId: "rd-g" }, { ...contribute(a.who, a.k) }, NOW)
        : a.kind === "close"
          ? decideCloseCollab({ collab: w.collab, contributions: w.contrib }, close("archived"), NOW)
          : decideTransition({ redemption: w.redemption, collab: w.collab, contributions: w.contrib }, { type: "TransitionRedemption", ...base("x", admin), redemptionId: "rd-g", transition: a.t, reason: null }, NOW);
    if (!d.outcome.ok) return w;
    const next: World = { ...w, bal: new Map(w.bal), contrib: new Map(w.contrib) };
    for (const e of d.entries) {
      next.bal.set(e.memberId, (next.bal.get(e.memberId) ?? 0) + signedAmount(e));
      if (e.cause.type === "contribution") next.contrib.set(e.memberId, (next.contrib.get(e.memberId) ?? 0) - signedAmount(e));
    }
    for (const wr of d.writes) {
      if (wr.t === "shop.collab.put") {
        expect(wr.from).toBe(w.collab.phase);
        next.collab = wr.collab;
      }
      if (wr.t === "shop.redemption.put") {
        if (wr.from === null) next.redemptions++;
        next.redemption = wr.redemption;
      }
    }
    return next;
  }

  test("NeverOverGoal, UnitsConserved, NoNegativeBalance, CompletedMeansGoalMet, OneGroupRedemption, RefundedMeansAllBack", () => {
    let checked = 0;
    const explore = (w: World, depth: number) => {
      const raised = raisedOf(w.contrib);
      expect(raised).toBeLessThanOrEqual(GOAL);
      for (const mm of members) {
        expect((w.bal.get(mm) ?? 0) + (w.contrib.get(mm) ?? 0)).toBe(WALLET);
        expect(w.bal.get(mm) ?? 0).toBeGreaterThanOrEqual(0);
      }
      const phase = w.collab.phase;
      if (phase === "completed" || phase === "delivered") {
        expect(raised).toBe(GOAL);
        expect(w.redemptions).toBe(1);
      }
      expect(w.redemptions).toBeLessThanOrEqual(1);
      if (phase === "refunded") for (const mm of members) expect(w.contrib.get(mm) ?? 0).toBe(0);
      checked++;
      if (depth === 0) return;
      for (const a of ACTIONS) explore(step(w, a), depth - 1);
    };
    explore({ bal: new Map(members.map((x) => [x, WALLET])), contrib: new Map(), collab: collab({ goal: GOAL as PosInt }), redemption: null, redemptions: 0 }, 5);
    expect(checked).toBeGreaterThan(10000);
  });
});
