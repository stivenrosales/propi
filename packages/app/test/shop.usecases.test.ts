import { describe, expect, test } from "vitest";
import { collabProgress, issueGiftCards, rewardCatalog } from "../src/shop/index.ts";
import {
  T0,
  WS,
  activeReward,
  admin,
  approver,
  closeCollab,
  configure,
  contribute,
  createCollab,
  createReward,
  m,
  memberActor,
  redeem,
  restock,
  setStatus,
  shopSetup,
  system,
  transition,
} from "./shop.setup.ts";

const eventTypes = (mem: ReturnType<typeof shopSetup>["mem"]): string[] => mem.events(WS).map((e): string => e.event.type).filter((t) => t.startsWith("redemption.") || t.startsWith("collab."));

describe("S44 S45 S46 catalog through the app", () => {
  test("S44: an admin creates a reward; members see it without the internal monetary cost", async () => {
    const { run, store } = shopSetup();
    const id = await activeReward(run, { variants: [{ id: "s", name: "Small", stock: 3 }] });
    const reader = store.reader(WS);
    const forAdmin = await rewardCatalog(reader, admin);
    const forMember = await rewardCatalog(reader, memberActor("ana"));
    expect(forAdmin).toEqual([expect.objectContaining({ id, title: "Lunch voucher", cost: 12, internalCost: { minor: 2500, currency: "PEN" }, categories: ["food"], instructions: "Show this at the counter" })]);
    expect(forMember).toEqual([expect.objectContaining({ id, internalCost: null, variants: [{ id: "s", name: "Small", stock: 3 }] })]);
    expect(await run(createReward({}, memberActor("ana")))).toEqual({ ok: false, replayed: false, error: { code: "forbidden", need: "rewards:write" } });
  });

  test("S45: only active rewards are redeemable and members only see active ones; archived keeps its history", async () => {
    const { run, fund, store } = shopSetup();
    await fund("ana", 50);
    const created = await run(createReward());
    if (!created.ok) throw new Error();
    const id = created.value.rewardId;
    expect(await run(redeem("ana", id))).toMatchObject({ ok: false, error: { code: "reward_not_active" } });
    expect(await rewardCatalog(store.reader(WS), memberActor("ana"))).toEqual([]);
    await run(setStatus(id, "active"));
    const r = await run(redeem("ana", id));
    expect(r.ok).toBe(true);
    await run(setStatus(id, "archived"));
    expect(await run(redeem("ana", id))).toMatchObject({ ok: false, error: { code: "reward_not_active" } });
    expect(await run(setStatus(id, "active"))).toMatchObject({ ok: false, error: { code: "illegal_reward_transition", from: "archived", to: "active" } });
    expect(store.state(WS).redemptions.filter((x) => x.rewardId === id)).toHaveLength(1);
  });

  test("S46: at stock 0 a reward cannot be redeemed until restocked; variants have their own stock", async () => {
    const { run, fund, store } = shopSetup();
    await fund("ana", 100);
    const id = await activeReward(run, { stock: 1 });
    expect(await run(redeem("ana", id))).toMatchObject({ ok: true, value: { state: "pending" } });
    expect(await run(redeem("ana", id))).toMatchObject({ ok: false, error: { code: "out_of_stock" } });
    expect(await run(restock(id, 2))).toEqual({ ok: true, replayed: false, value: { rewardId: id, variantId: null, stock: 2 } });
    expect(await run(redeem("ana", id))).toMatchObject({ ok: true });
    expect(store.state(WS).rewards.find((r) => r.id === id)?.stock).toBe(1);

    const v = await activeReward(run, { variants: [{ id: "s", name: "S", stock: 0 }, { id: "l", name: "L", stock: 1 }] });
    expect(await run(redeem("ana", v, "web:v1", memberActor("ana"), "s"))).toMatchObject({ ok: false, error: { code: "out_of_stock" } });
    expect(await run(redeem("ana", v, "web:v2", memberActor("ana"), "l"))).toMatchObject({ ok: true });
    expect(store.state(WS).rewards.find((r) => r.id === v)?.variants).toEqual([{ id: "s", name: "S", stock: 0 }, { id: "l", name: "L", stock: 0 }]);
  });
});

describe("S35 S50 redeem through the app", () => {
  test("S50: 42 redeemable, reward cost 12 -> pending, 30 redeemable, stock reserved", async () => {
    const { run, fund, redeemable, mem, store, app } = shopSetup();
    await fund("ana", 42);
    const id = await activeReward(run, { stock: 5 });
    const r = await run(redeem("ana", id));
    expect(r).toMatchObject({ ok: true, replayed: false, value: { state: "pending", cost: 12, redeemable: 30 } });
    expect(await redeemable("ana")).toBe(30);
    expect(mem.entries(WS).filter((e) => e.kind === "spend").map((e) => [e.memberId, e.amount, e.cause])).toEqual([["ana", 12, { type: "redemption", redemptionId: r.ok ? r.value.redemptionId : "" }]]);
    expect(store.state(WS).rewards[0]?.stock).toBe(4);
    expect(eventTypes(mem)).toEqual(["redemption.created"]);
    expect((await app.ledgerCheck(WS)).ok).toBe(true);
  });

  test("S35: a redemption is refused rather than make redeemable negative", async () => {
    const { run, fund, redeemable, mem } = shopSetup();
    await fund("ana", 11);
    const id = await activeReward(run);
    expect(await run(redeem("ana", id))).toEqual({ ok: false, replayed: false, error: { code: "insufficient_redeemable", cost: 12, redeemable: 11 } });
    expect(await redeemable("ana")).toBe(11);
    expect(mem.entries(WS).filter((e) => e.kind === "spend")).toEqual([]);
  });

  test("S17 S50: the same redeem key twice debits once and replays the first result", async () => {
    const { run, fund, redeemable } = shopSetup();
    await fund("ana", 30);
    const id = await activeReward(run);
    const first = await run(redeem("ana", id, "web:redeem:same"));
    const again = await run(redeem("ana", id, "web:redeem:same"));
    expect(again).toEqual({ ...first, replayed: true });
    expect(await redeemable("ana")).toBe(18);
  });
});

describe("S47 monthly budget through the app", () => {
  test("S47: a redemption that would exceed the remaining monthly budget is refused; a rejection frees it", async () => {
    const { run, fund, mem } = shopSetup();
    await run(configure({ monthlyBudget: { minor: 5000, currency: "PEN" } }));
    for (const who of ["ana", "bob", "diana"]) await fund(who, 20);
    const id = await activeReward(run); // 2500 PEN cents each
    const a = await run(redeem("ana", id));
    expect(await run(redeem("bob", id))).toMatchObject({ ok: true });
    expect(await run(redeem("diana", id))).toEqual({ ok: false, replayed: false, error: { code: "budget_exceeded", remaining: { minor: 0, currency: "PEN" } } });
    if (!a.ok) throw new Error();
    await run(transition(a.value.redemptionId, "reject"));
    expect(await run(redeem("diana", id))).toMatchObject({ ok: true });
    expect(mem.lockLog.at(-1)).toEqual([`redemption:reward:${id}`, "budget:ws-1:2026-11", "member:diana"]);
  });
});

describe("S48 one Redeem command for chat and web", () => {
  test("S48: a redemption from the chat platform and one from the web go through the same use case", async () => {
    const { run, fund, redeemable } = shopSetup();
    await fund("ana", 30);
    const id = await activeReward(run);
    const chat = await run(redeem("ana", id, "slack:redeem:T1:U9:view-1"));
    const web = await run(redeem("ana", id, "web:redeem:session-1"));
    expect(chat).toMatchObject({ ok: true, value: { state: "pending", cost: 12, redeemable: 18 } });
    expect(web).toMatchObject({ ok: true, value: { state: "pending", cost: 12, redeemable: 6 } });
    expect(await redeemable("ana")).toBe(6);
  });
});

describe("S49 S51 S52 S53 S54 S55 redemption lifecycle through the app", () => {
  test("S49 S54: pending -> approved -> fulfilled, each change emits its event", async () => {
    const { run, fund, mem } = shopSetup();
    await fund("ana", 20);
    const r = await run(redeem("ana", await activeReward(run)));
    if (!r.ok) throw new Error();
    const id = r.value.redemptionId;
    expect(await run(transition(id, "fulfil", approver, "web:early-fulfil"))).toMatchObject({ ok: false, error: { code: "illegal_transition", from: "pending", transition: "fulfil" } });
    expect(await run(transition(id, "approve", approver))).toEqual({ ok: true, replayed: false, value: { redemptionId: id, state: "approved", changed: true, refunded: 0 } });
    expect(await run(transition(id, "fulfil", approver))).toMatchObject({ ok: true, value: { state: "fulfilled" } });
    expect(eventTypes(mem)).toEqual(["redemption.created", "redemption.approved", "redemption.fulfilled"]);
    expect(mem.events(WS).filter((e) => (e.event.type as string) === "redemption.fulfilled").map((e) => (e.event as unknown as { notify: string[] }).notify)).toEqual([["ana"]]);
  });

  test("S51: rejection refunds the full cost and releases stock atomically with the state change", async () => {
    const { run, fund, redeemable, mem, store, app } = shopSetup();
    await fund("ana", 42);
    const rw = await activeReward(run, { stock: 1 });
    const r = await run(redeem("ana", rw));
    if (!r.ok) throw new Error();
    expect(await run(transition(r.value.redemptionId, "reject", approver))).toMatchObject({ ok: true, value: { state: "rejected", refunded: 12 } });
    expect(await redeemable("ana")).toBe(42);
    expect(store.state(WS).rewards[0]?.stock).toBe(1);
    const rejectKey = mem.commandLog(WS).find((c) => c.commandType === "TransitionRedemption")?.key;
    expect(mem.entries(WS).filter((e) => e.kind === "refund").map((e) => [e.commandKey, e.amount])).toEqual([[rejectKey, 12]]);
    expect(mem.events(WS).filter((e) => (e.event.type as string) === "redemption.rejected").map((e) => e.commandKey)).toEqual([rejectKey]);
    expect((await app.ledgerCheck(WS)).ok).toBe(true);
  });

  test("S51: cancelling an approved redemption refunds and releases stock; a second cancel is refused", async () => {
    const { run, fund, redeemable, store } = shopSetup();
    await fund("ana", 12);
    const r = await run(redeem("ana", await activeReward(run, { stock: 1 })));
    if (!r.ok) throw new Error();
    await run(transition(r.value.redemptionId, "approve"));
    expect(await run(transition(r.value.redemptionId, "cancel", approver, "web:approver-cancel"))).toMatchObject({ ok: false, error: { code: "forbidden", need: "admin" } });
    expect(await run(transition(r.value.redemptionId, "cancel"))).toMatchObject({ ok: true, value: { state: "cancelled", refunded: 12 } });
    expect(await run(transition(r.value.redemptionId, "cancel", admin, "api:t:cancel-2"))).toMatchObject({ ok: false, error: { code: "illegal_transition", from: "cancelled" } });
    expect(await redeemable("ana")).toBe(12);
    expect(store.state(WS).rewards[0]?.stock).toBe(1);
  });

  test("S52: auto-approval globally or per reward moves a new redemption straight to approved", async () => {
    const { run, fund, mem } = shopSetup();
    await fund("ana", 40);
    const perReward = await activeReward(run, { autoApprove: true });
    expect(await run(redeem("ana", perReward))).toMatchObject({ ok: true, value: { state: "approved" } });
    const plain = await activeReward(run);
    expect(await run(redeem("ana", plain))).toMatchObject({ ok: true, value: { state: "pending" } });
    await run(configure({ autoApprove: true }));
    expect(await run(redeem("ana", plain))).toMatchObject({ ok: true, value: { state: "approved" } });
    expect(eventTypes(mem)).toEqual(["redemption.created", "redemption.approved", "redemption.created", "redemption.created", "redemption.approved"]);
  });

  test("S53: an external system fulfils through the API; fulfilling again is a no-op, and the same key replays", async () => {
    const { run, fund, mem } = shopSetup();
    await fund("ana", 20);
    const r = await run(redeem("ana", await activeReward(run, { autoApprove: true })));
    if (!r.ok) throw new Error();
    const api = { kind: "apiToken", tokenId: "tok-1", scopes: ["redemptions:write"] } as never;
    const first = await run(transition(r.value.redemptionId, "fulfil", api, "api:tok-1:idem-1"));
    expect(first).toEqual({ ok: true, replayed: false, value: { redemptionId: r.value.redemptionId, state: "fulfilled", changed: true, refunded: 0 } });
    expect(await run(transition(r.value.redemptionId, "fulfil", api, "api:tok-1:idem-1"))).toEqual({ ...first, replayed: true });
    expect(await run(transition(r.value.redemptionId, "fulfil", api, "api:tok-1:idem-2"))).toEqual({ ok: true, replayed: false, value: { redemptionId: r.value.redemptionId, state: "fulfilled", changed: false, refunded: 0 } });
    expect(eventTypes(mem).filter((t) => t === "redemption.fulfilled")).toHaveLength(1);
  });

  test("S55: an admin creates a manual redemption on behalf of a member", async () => {
    const { run, fund, redeemable, store } = shopSetup();
    await fund("bob", 15);
    const r = await run(redeem("bob", await activeReward(run), "web:manual:1", admin));
    expect(r).toMatchObject({ ok: true, value: { state: "approved", redeemable: 3 } });
    expect(await redeemable("bob")).toBe(3);
    expect(store.state(WS).redemptions[0]).toMatchObject({ memberId: "bob", onBehalfOf: { admin: "boss" } });
    expect(await run(redeem("bob", await activeReward(run), "web:manual:2", memberActor("ana")))).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("G4: reject and cancel take the redemption key, the reward key and the member key, in that order", async () => {
    const { run, fund, mem } = shopSetup();
    await fund("ana", 20);
    const rw = await activeReward(run, { stock: 2 });
    const r = await run(redeem("ana", rw));
    if (!r.ok) throw new Error();
    expect(mem.lockLog.at(-1)).toEqual([`redemption:reward:${rw}`, "member:ana"]);
    await run(transition(r.value.redemptionId, "reject"));
    expect(mem.lockLog.at(-1)).toEqual([`redemption:${r.value.redemptionId}`, `redemption:reward:${rw}`, "member:ana"]);
  });
});

describe("S56 S57 S58 S59 collaborative rewards through the app", () => {
  async function collabWith(goal: number, over: Parameters<typeof createCollab>[1] = {}) {
    const s = shopSetup();
    for (const who of ["ana", "bob", "diana"]) await s.fund(who, 10);
    const c = await s.run(createCollab(goal, over));
    if (!c.ok) throw new Error();
    return { ...s, collabId: c.value.collabId };
  }

  test("S56: contributions spend redeemable and progress is visible to all", async () => {
    const { run, collabId, redeemable, store } = await collabWith(12);
    expect(await run(contribute("ana", collabId, 4))).toEqual({ ok: true, replayed: false, value: { collabId, taken: 4, raised: 4, goal: 12, redemptionId: null } });
    await run(contribute("bob", collabId, 3));
    expect(await redeemable("ana")).toBe(6);
    expect(await collabProgress(store.reader(WS), collabId)).toEqual({ collabId, title: "Team dinner", goal: 12, raised: 7, phase: "open", contributors: [{ memberId: "ana", amount: 4 }, { memberId: "bob", amount: 3 }] });
  });

  test("S59 S57: an overshooting contribution is capped; reaching the goal creates one group redemption and notifies contributors", async () => {
    const { run, collabId, redeemable, mem, store } = await collabWith(10);
    await run(contribute("ana", collabId, 6));
    const last = await run(contribute("bob", collabId, 9));
    expect(last).toMatchObject({ ok: true, value: { taken: 4, raised: 10 } });
    expect(await redeemable("bob")).toBe(6);
    expect(await run(contribute("diana", collabId, 1))).toMatchObject({ ok: false, error: { code: "collab_closed" } });
    const groups = store.state(WS).redemptions.filter((r) => r.collabId === collabId);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ memberId: null, cost: 10, state: "pending" });
    const completed = mem.events(WS).find((e) => (e.event.type as string) === "collab.completed")?.event as unknown as { notify: string[] };
    expect(completed.notify).toEqual(["ana", "bob"]);
  });

  test("S58: archiving before the goal refunds every contribution", async () => {
    const { run, collabId, redeemable, mem } = await collabWith(20);
    await run(contribute("ana", collabId, 4));
    await run(contribute("bob", collabId, 7));
    expect(await run(closeCollab(collabId, "archived"))).toEqual({ ok: true, replayed: false, value: { collabId, members: 2, refunded: 11 } });
    expect(await redeemable("ana")).toBe(10);
    expect(await redeemable("bob")).toBe(10);
    expect(await run(contribute("ana", collabId, 1))).toMatchObject({ ok: false, error: { code: "collab_closed" } });
    expect(eventTypes(mem).at(-1)).toBe("collab.refunded");
  });

  test("S58: the scheduler closes a collab once its deadline passed and refunds everyone; the key makes it exactly once", async () => {
    const { run, collabId, redeemable, mem } = await collabWith(20, { deadline: T0 + 1000 });
    await run(contribute("ana", collabId, 5));
    expect(await run(closeCollab(collabId, "deadline", system))).toMatchObject({ ok: false, error: { code: "deadline_not_reached" } });
    mem.clock.advance(1000);
    expect(await run({ ...closeCollab(collabId, "deadline", system), key: `collab:${collabId}:refund:2` as never })).toMatchObject({ ok: true, value: { refunded: 5 } });
    expect(await run({ ...closeCollab(collabId, "deadline", system), key: `collab:${collabId}:refund:2` as never })).toMatchObject({ ok: true, replayed: true });
    expect(await redeemable("ana")).toBe(10);
    expect(mem.entries(WS).filter((e) => e.kind === "refund")).toHaveLength(1);
  });

  test("S58: rejecting the group redemption refunds every contributor", async () => {
    const { run, collabId, redeemable, store, app } = await collabWith(10);
    await run(contribute("ana", collabId, 3));
    const done = await run(contribute("bob", collabId, 7));
    if (!done.ok || done.value.redemptionId === null) throw new Error();
    expect(await run(transition(done.value.redemptionId, "reject", approver))).toMatchObject({ ok: true, value: { state: "rejected", refunded: 10 } });
    expect(await redeemable("ana")).toBe(10);
    expect(await redeemable("bob")).toBe(10);
    expect(store.state(WS).collabs[0]?.phase).toBe("refunded");
    expect((await app.ledgerCheck(WS)).ok).toBe(true);
  });

  test("S57: fulfilling the group redemption delivers the collab", async () => {
    const { run, collabId, store } = await collabWith(5, { autoApprove: true });
    const done = await run(contribute("ana", collabId, 5));
    if (!done.ok || done.value.redemptionId === null) throw new Error();
    expect(store.state(WS).redemptions[0]?.state).toBe("approved");
    await run(transition(done.value.redemptionId, "fulfil", approver));
    expect(store.state(WS).collabs[0]?.phase).toBe("delivered");
  });
});

describe("S108 gift cards through the app", () => {
  test("S108: refused when the prepaid balance is short; reservations count; approval fulfils and the relay issues once", async () => {
    const { run, fund, store, giftCards, app, mem } = shopSetup({ prepaid: 7000 });
    for (const who of ["ana", "bob"]) await fund(who, 50);
    const card = await activeReward(run, { giftCard: true, internalCost: { minor: 5000, currency: "PEN" } });
    const a = await run(redeem("ana", card));
    expect(a).toMatchObject({ ok: true, value: { state: "pending" } });
    expect(await run(redeem("bob", card))).toEqual({ ok: false, replayed: false, error: { code: "prepaid_insufficient", available: { minor: 2000, currency: "PEN" } } });
    expect(mem.lockLog.at(-1)).toEqual([`redemption:reward:${card}`, "prepaid:ws-1", "member:bob"]);
    if (!a.ok) throw new Error();
    expect(await run(transition(a.value.redemptionId, "approve", approver))).toMatchObject({ ok: true, value: { state: "fulfilled" } });
    expect(eventTypes(mem).slice(-2)).toEqual(["redemption.approved", "redemption.fulfilled"]);

    expect(await issueGiftCards(app, store.ports, giftCards!, WS)).toEqual({ issued: 1 });
    expect(await issueGiftCards(app, store.ports, giftCards!, WS)).toEqual({ issued: 0 });
    expect(giftCards!.issued()).toHaveLength(1);
    expect(store.state(WS).redemptions[0]?.cardIssued).toBe(true);
    expect(await store.reader(WS).prepaidAvailable()).toEqual({ minor: 2000, currency: "PEN" });
  });

  test("S108: a rejected gift-card redemption releases its prepaid reservation", async () => {
    const { run, fund, store } = shopSetup({ prepaid: 5000 });
    for (const who of ["ana", "bob"]) await fund(who, 50);
    const card = await activeReward(run, { giftCard: true, internalCost: { minor: 5000, currency: "PEN" } });
    const a = await run(redeem("ana", card));
    if (!a.ok) throw new Error();
    expect(await store.reader(WS).prepaidAvailable()).toEqual({ minor: 0, currency: "PEN" });
    await run(transition(a.value.redemptionId, "reject"));
    expect(await run(redeem("bob", card))).toMatchObject({ ok: true });
  });
});

describe("shop store wiring", () => {
  test("a shop command over ports without the shop store fails loudly instead of dropping writes", async () => {
    const { createApp } = await import("../src/index.ts");
    const { createMemoryPorts } = await import("../src/testing/index.ts");
    const { shopHandlers } = await import("../src/shop/index.ts");
    const { defaultSettings } = await import("@propi/core");
    const { HANDLERS } = await import("../src/index.ts");
    const mem = createMemoryPorts({ now: T0 });
    mem.addWorkspace(WS, defaultSettings());
    // An adapter whose Tx has only the core reads (the memory ports carry the shop store, so strip it).
    const CORE_TX = ["claim", "commit", "balances", "allowanceUsed", "netPerReceiver", "gift", "giftByMessage", "activeReactionGift", "reactionClosedByAdmin", "reactionReversals", "redeemableByMember"] as const;
    const bare = { ...mem.ports, uow: { run: (ws, locks, fn) => mem.ports.uow.run(ws, locks, (tx) => fn(Object.fromEntries(CORE_TX.map((k) => [k, tx[k]])) as unknown as typeof tx)) } } satisfies typeof mem.ports;
    const app = createApp(bare, { handlers: shopHandlers.filter((h) => !HANDLERS.some((x) => x.type === h.type)) });
    await expect(app.executeAny(redeem("ana", "rw-1"))).rejects.toThrow(/shop store is not wired/);
    expect(mem.entries(WS)).toEqual([]);
    expect(m("ana")).toBe("ana");
  });
});

describe("S2 batch redemption through the app", () => {
  const redeemN = (who: string, rewardId: string, quantity: number, variantId: string | null = null) => ({ ...redeem(who, rewardId, undefined, memberActor(who), variantId), quantity });

  test("S2: 3 units debit 3 x cost once, take 3 stock units and leave one pending redemption with quantity 3", async () => {
    const { run, fund, redeemable, mem, store, app } = shopSetup();
    await fund("ana", 42);
    const id = await activeReward(run, { stock: 5 });
    const r = await run(redeemN("ana", id, 3));
    expect(r).toMatchObject({ ok: true, value: { state: "pending", cost: 36, redeemable: 6 } });
    expect(await redeemable("ana")).toBe(6);
    expect(mem.entries(WS).filter((e) => e.kind === "spend").map((e) => e.amount)).toEqual([36]);
    expect(store.state(WS).rewards[0]?.stock).toBe(2);
    expect(store.state(WS).redemptions).toEqual([expect.objectContaining({ quantity: 3, cost: 36, state: "pending" })]);
    expect(mem.events(WS).filter((e) => e.event.type === "redemption.created").map((e) => e.event)).toEqual([expect.objectContaining({ cost: 36, quantity: 3 })]);
    expect((await app.ledgerCheck(WS)).ok).toBe(true);
  });

  test("S2: stock below N, balance below N x cost and a budget below N units refuse the whole batch", async () => {
    const { run, fund, store } = shopSetup();
    await fund("ana", 100);
    const id = await activeReward(run, { stock: 2 });
    expect(await run(redeemN("ana", id, 3))).toMatchObject({ ok: false, error: { code: "out_of_stock", available: 2 } });
    const cheap = await activeReward(run, { cost: 30 });
    expect(await run(redeemN("ana", cheap, 4))).toMatchObject({ ok: false, error: { code: "insufficient_redeemable", cost: 120, redeemable: 100 } });
    await run(configure({ monthlyBudget: { minor: 5000, currency: "PEN" } }));
    expect(await run(redeemN("ana", id, 3))).toMatchObject({ ok: false, error: { code: "out_of_stock" } });
    const unlimited = await activeReward(run, { cost: 1 });
    expect(await run(redeemN("ana", unlimited, 3))).toMatchObject({ ok: false, error: { code: "budget_exceeded", remaining: { minor: 5000, currency: "PEN" } } });
    expect(store.state(WS).redemptions).toEqual([]);
  });

  test("S2: one approval covers all units; rejecting refunds N x cost and returns N stock units", async () => {
    const { run, fund, redeemable, store, mem } = shopSetup();
    await fund("ana", 50);
    const id = await activeReward(run, { stock: 4 });
    const a = await run(redeemN("ana", id, 2));
    if (!a.ok) throw new Error(JSON.stringify(a.error));
    expect(await run(transition(a.value.redemptionId, "approve"))).toMatchObject({ ok: true, value: { state: "approved" } });
    expect(store.state(WS).redemptions).toHaveLength(1);
    expect(await run(transition(a.value.redemptionId, "cancel"))).toMatchObject({ ok: true, value: { state: "cancelled", refunded: 24 } });
    expect(await redeemable("ana")).toBe(50);
    expect(store.state(WS).rewards[0]?.stock).toBe(4);
    const b = await run(redeemN("ana", id, 3));
    if (!b.ok) throw new Error(JSON.stringify(b.error));
    expect(await run(transition(b.value.redemptionId, "reject"))).toMatchObject({ ok: true, value: { state: "rejected", refunded: 36 } });
    expect(await redeemable("ana")).toBe(50);
    expect(store.state(WS).rewards[0]?.stock).toBe(4);
    expect(mem.events(WS).filter((e) => e.event.type === "redemption.rejected").map((e) => e.event)).toEqual([expect.objectContaining({ cost: 36, quantity: 3 })]);
  });

  test("S2: a single-unit redemption behaves exactly as before (quantity 1)", async () => {
    const { run, fund, store } = shopSetup();
    await fund("ana", 42);
    const id = await activeReward(run, { stock: 5 });
    expect(await run(redeem("ana", id))).toMatchObject({ ok: true, value: { state: "pending", cost: 12, redeemable: 30 } });
    expect(store.state(WS).rewards[0]?.stock).toBe(4);
    expect(store.state(WS).redemptions).toEqual([expect.objectContaining({ quantity: 1, cost: 12 })]);
  });
});
