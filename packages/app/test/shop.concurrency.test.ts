// G5 shop cases through the in-memory mutex fakes, plus the TLA+ invariants under races.
import { describe, expect, test } from "vitest";
import { WS, activeReward, admin, approver, closeCollab, configure, contribute, createCollab, m, redeem, shopSetup, transition } from "./shop.setup.ts";

const ok = (rs: readonly { ok: boolean }[]) => rs.filter((r) => r.ok).length;

describe("G5 redemptions under concurrency", () => {
  test("S35 G5: 10 parallel redemptions with redeemable for 3 -> exactly 3 succeed", async () => {
    const { run, fund, redeemable, mem, app } = shopSetup();
    await fund("ana", 36);
    const id = await activeReward(run);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => run(redeem("ana", id, `web:redeem:par:${i}`))));
    expect(ok(rs)).toBe(3);
    expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.error.code === "insufficient_redeemable")).toBe(true);
    expect(await redeemable("ana")).toBe(0);
    expect(mem.entries(WS).filter((e) => e.kind === "spend")).toHaveLength(3);
    expect((await app.ledgerCheck(WS)).ok).toBe(true);
  });

  test("S35: without the member lock the same race overspends (the lock is what prevents it)", async () => {
    const { run, fund, redeemable } = shopSetup({ locking: false });
    await fund("ana", 36);
    const id = await activeReward(run);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => run(redeem("ana", id, `web:redeem:race:${i}`))));
    expect(ok(rs)).toBeGreaterThan(3);
    expect(await redeemable("ana")).toBeLessThan(0);
  });

  test("S46 G5: the last unit of stock goes to exactly one of many members", async () => {
    const { run, fund, store } = shopSetup();
    const who = ["ana", "bob", "diana", "lind"];
    for (const w of who) await fund(w, 20);
    const id = await activeReward(run, { stock: 1 });
    const rs = await Promise.all(who.map((w) => run(redeem(w, id))));
    expect(ok(rs)).toBe(1);
    expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.error.code === "out_of_stock")).toBe(true);
    expect(store.state(WS).rewards[0]?.stock).toBe(0);
  });

  test("S47 G5: parallel redemptions by different members never exceed the monthly budget", async () => {
    const { run, fund, store } = shopSetup();
    await run(configure({ monthlyBudget: { minor: 5000, currency: "PEN" } }));
    const who = ["ana", "bob", "diana", "lind"];
    for (const w of who) await fund(w, 20);
    const id = await activeReward(run);
    const rs = await Promise.all(who.map((w) => run(redeem(w, id))));
    expect(ok(rs)).toBe(2);
    expect(store.state(WS).redemptions.reduce((t, r) => t + (r.internalCost?.minor ?? 0), 0)).toBe(5000);
  });

  test("S51 G5: reject vs approve on a pending redemption -> one wins, at most one refund (AtMostOneRefund)", async () => {
    const { run, fund, redeemable, mem, store } = shopSetup();
    await fund("ana", 12);
    const rw = await activeReward(run, { stock: 1 });
    const r = await run(redeem("ana", rw));
    if (!r.ok) throw new Error();
    const id = r.value.redemptionId;
    const [rej, app] = await Promise.all([run(transition(id, "reject", approver)), run(transition(id, "approve", admin))]);
    expect(ok([rej, app])).toBe(1);
    await run(transition(id, "fulfil", approver));
    const refunds = mem.entries(WS).filter((e) => e.kind === "refund");
    expect(refunds.length).toBeLessThanOrEqual(1);
    const state = store.state(WS).redemptions[0]?.state;
    // UnitsConserved and StockConserved
    expect(await redeemable("ana")).toBe(12 - 12 + 12 * refunds.length);
    expect((store.state(WS).rewards[0]?.stock ?? 0) + (state === "rejected" ? 0 : 1)).toBe(1);
    expect(refunds.length === 1).toBe(state === "rejected");
  });

  test("S51 S53 G5: cancel vs fulfil on an approved redemption -> one wins, at most one refund", async () => {
    for (let round = 0; round < 5; round++) {
      const { run, fund, redeemable, mem, store } = shopSetup();
      await fund("ana", 12);
      const rw = await activeReward(run, { stock: 1, autoApprove: true });
      const r = await run(redeem("ana", rw));
      if (!r.ok) throw new Error();
      const id = r.value.redemptionId;
      const calls = [run(transition(id, "cancel", admin)), run(transition(id, "fulfil", approver)), run(transition(id, "cancel", admin, `api:t:cancel-${round}`))];
      const rs = await Promise.all(round % 2 === 0 ? calls : calls.reverse());
      const changed = rs.filter((x) => x.ok && (x.value as { changed: boolean }).changed).length;
      expect(changed).toBe(1);
      const refunds = mem.entries(WS).filter((e) => e.kind === "refund").length;
      expect(refunds).toBeLessThanOrEqual(1);
      const state = store.state(WS).redemptions[0]?.state;
      expect(refunds === 1).toBe(state === "cancelled");
      expect(await redeemable("ana")).toBe(12 * refunds);
      expect((store.state(WS).rewards[0]?.stock ?? 0) + (state === "cancelled" ? 0 : 1)).toBe(1);
    }
  });
});

describe("Collab.tla invariants under concurrency", () => {
  test("S59 S57: parallel contributions never overshoot the goal and create exactly one group redemption", async () => {
    const who = ["ana", "bob", "diana", "lind", "e1", "e2"];
    const { run, fund, redeemable, store, mem, app } = shopSetup({ members: ["e1", "e2"] });
    for (const w of who) await fund(w, 10);
    const c = await run(createCollab(10));
    if (!c.ok) throw new Error();
    const rs = await Promise.all(who.map((w) => run(contribute(w, c.value.collabId, 4))));
    const taken = rs.reduce((t, r) => t + (r.ok ? r.value.taken : 0), 0);
    expect(taken).toBe(10); // NeverOverGoal + CompletedMeansGoalMet
    expect(store.state(WS).redemptions.filter((r) => r.collabId === c.value.collabId)).toHaveLength(1); // OneGroupRedemption
    expect(mem.events(WS).filter((e) => (e.event.type as string) === "collab.completed")).toHaveLength(1);
    // UnitsConserved: wallet = balance + contribution for everyone
    let total = 0;
    for (const w of who) total += 10 - (await redeemable(w));
    expect(total).toBe(10);
    expect((await app.ledgerCheck(WS)).ok).toBe(true);
  });

  test("S58: contributions racing an archive -> refunded means everyone got everything back", async () => {
    const who = ["ana", "bob", "diana", "lind"];
    const { run, fund, redeemable, store } = shopSetup();
    for (const w of who) await fund(w, 10);
    const c = await run(createCollab(100));
    if (!c.ok) throw new Error();
    const id = c.value.collabId;
    await run(contribute("ana", id, 2));
    await Promise.all([...who.map((w) => run(contribute(w, id, 3))), run(closeCollab(id, "archived"))]);
    expect(store.state(WS).collabs[0]?.phase).toBe("refunded");
    for (const w of who) expect(await redeemable(w)).toBe(10); // RefundedMeansAllBack
    expect(m("ana")).toBe("ana");
  });
});
