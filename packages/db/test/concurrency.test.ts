// G5: the Postgres concurrency acceptance suite. Every case fires its commands with Promise.all
// against real Postgres (advisory locks, READ COMMITTED, claim-first command_log).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { accept, createApp, type Actor, type CommandKey, type Instant, type PosInt, type ShopReader, type WorkspaceId } from "@propi/app";
import { createDbPorts, createDbInspector, type PrismaClient } from "../src/index.ts";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./pg.ts";
import { T0, admin, key, m, memberActor, mention, msg, postgresBackend, type Harness } from "./harness.ts";

let db: TestDatabase;
let replicaA: PrismaClient;
let replicaB: PrismaClient;
let h: Harness;

let n = 0;
const give = (ws: WorkspaceId, from: string, to: string, tacos = 1, ref = `T:C1:g${++n}`) =>
  ({ type: "GiveByMessage", key: key(`slack:msg:${ref}`), workspaceId: ws, actor: memberActor(from), at: T0, messageRef: ref, message: msg(`@${to}`, [mention(to)], tacos) }) as const;

// ───────────── Shop commands (same shapes as packages/app/test/shop.setup.ts) ─────────────

const approver = memberActor("rita", "approver");
let s = 0;
const base = (k: string, actor: Actor = admin) => ({ key: key(k), workspaceId: h.ws, actor, at: T0 });
const fund = (who: string, amount: number) =>
  h.app.execute({ type: "GrantBonus", ...base(`api:fund:${++s}`), memberIds: [m(who)], amount: amount as PosInt, reason: "fund" });
const redeem = (who: string, rewardId: string, k = `web:redeem:${who}:${++s}`) =>
  h.app.execute({ type: "Redeem", ...base(k, memberActor(who)), memberId: m(who), rewardId, variantId: null });
const transition = (redemptionId: string, t: "approve" | "reject" | "cancel" | "fulfil", actor: Actor = admin, k = `redemption:${redemptionId}:${t}`) =>
  h.app.execute({ type: "TransitionRedemption", ...base(k, actor), redemptionId, transition: t, reason: t === "reject" || t === "cancel" ? "test" : null });
const contribute = (who: string, collabId: string, amount: number) =>
  h.app.execute({ type: "Contribute", ...base(`web:contrib:${who}:${++s}`, memberActor(who)), collabId, memberId: m(who), amount });

/** An active reward (cost 12, internal cost 25.00 PEN), created and published through the app. */
async function activeReward(over: { stock?: number | null; autoApprove?: boolean | null } = {}): Promise<string> {
  const r = await h.app.execute({
    type: "CreateReward",
    ...base(`web:reward:${++s}`),
    reward: {
      title: "Lunch voucher", description: "Lunch for two", image: null, cost: 12, stock: over.stock ?? null, variants: [], categories: ["food"],
      internalCost: { minor: 2500, currency: "PEN" }, instructions: "Show this at the counter", autoApprove: over.autoApprove ?? null, giftCard: false,
    },
  });
  if (!r.ok) throw new Error(`createReward failed: ${JSON.stringify(r.error)}`);
  const p = await h.app.execute({ type: "SetRewardStatus", ...base(`web:status:${++s}`), rewardId: r.value.rewardId, status: "active" });
  if (!p.ok) throw new Error("publish failed");
  return r.value.rewardId;
}

const shop = (): ShopReader => h.ports.reader.workspace(h.ws) as unknown as ShopReader;
const redeemable = async (who: string) => (await h.app.balances(h.ws, m(who))).redeemable;
const okCount = (rs: readonly { ok: boolean }[]) => rs.filter((r) => r.ok).length;
const errorCode = (r: { ok: boolean }) => (r.ok ? null : (r as unknown as { error: { code: string } }).error.code);

describe.skipIf(!hasDatabase)("G5: Postgres concurrency acceptance", () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    replicaA = db.client(30);
    replicaB = db.client(30);
  }, 120_000);
  afterAll(async () => {
    await db?.drop();
  });

  const fresh = async () => (h = await postgresBackend(() => replicaA)());

  test("S19: 20 parallel gifts from one giver with allowance 5 give exactly 5 units", async () => {
    await fresh();
    const results = await Promise.all(Array.from({ length: 20 }, () => h.app.execute(give(h.ws, "giver", "ana"))));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.error.code === "over_allowance")).toHaveLength(15);
    expect(await h.app.balances(h.ws, m("giver"))).toEqual({ received: 0, given: 5, redeemable: 0 });
    expect(await h.entries()).toHaveLength(5);
    expect(await h.app.allowance(h.ws, m("giver"))).toMatchObject({ used: 5, remaining: 0 });
  });

  test("the race is real: without advisory locks the same 20 parallel gifts overspend on Postgres", async () => {
    await fresh();
    const unlocked = createApp(createDbPorts(replicaB, { clock: h.ports.clock, advisoryLocks: false }));
    await Promise.all(Array.from({ length: 20 }, () => unlocked.execute(give(h.ws, "giver", "ana"))));
    expect((await h.app.balances(h.ws, m("giver"))).given).toBeGreaterThan(5);
  });

  test("S35: 10 parallel redemptions with redeemable for 3 -> exactly 3 succeed", async () => {
    await fresh();
    await fund("ana", 36);
    const id = await activeReward();
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => redeem("ana", id, `web:redeem:par:${i}`)));
    expect(okCount(rs)).toBe(3);
    expect(rs.filter((r) => !r.ok).map(errorCode)).toEqual(Array.from({ length: 7 }, () => "insufficient_redeemable"));
    expect(await redeemable("ana")).toBe(0);
    expect((await h.entries()).filter((e) => e.kind === "spend")).toHaveLength(3);
    expect(await shop().redemptions()).toHaveLength(3);
    expect(await h.app.ledgerCheck(h.ws)).toMatchObject({ ok: true });
  });

  test("S46: the last unit of stock goes to exactly one of many members (conditional decrement)", async () => {
    await fresh();
    const who = ["ana", "bob", "diana", "lind"];
    for (const w of who) await fund(w, 20);
    const id = await activeReward({ stock: 1 });
    const rs = await Promise.all(who.map((w) => redeem(w, id)));
    expect(okCount(rs)).toBe(1);
    expect(rs.filter((r) => !r.ok).map(errorCode)).toEqual(["out_of_stock", "out_of_stock", "out_of_stock"]);
    expect((await shop().reward(id))?.stock).toBe(0);
    expect((await h.entries()).filter((e) => e.kind === "spend")).toHaveLength(1);
  });

  test("S47: parallel redemptions by different members never exceed the monthly budget", async () => {
    await fresh();
    await h.app.execute({ type: "ConfigureShop", ...base("web:cfg"), settings: { autoApprove: false, monthlyBudget: { minor: 5000, currency: "PEN" } } });
    const who = ["ana", "bob", "diana", "lind"];
    for (const w of who) await fund(w, 20);
    const id = await activeReward();
    const rs = await Promise.all(who.map((w) => redeem(w, id)));
    expect(okCount(rs)).toBe(2);
    expect(rs.filter((r) => !r.ok).map(errorCode)).toEqual(["budget_exceeded", "budget_exceeded"]);
    expect(await shop().budgetSpent("2026-11")).toBe(5000);
  });

  test("A->B and B->A at once (plus bonuses locking both) all succeed without deadlock", async () => {
    await fresh();
    for (const id of ["ana", "bob"]) await h.addMember({ id: m(id), role: "member", active: true, dailyLimitOverride: 50 as PosInt });
    const cmds = [
      ...Array.from({ length: 10 }, () => h.app.execute(give(h.ws, "ana", "bob"))),
      ...Array.from({ length: 10 }, () => h.app.execute(give(h.ws, "bob", "ana"))),
      ...Array.from({ length: 5 }, (_, i) =>
        h.app.execute({ type: "GrantBonus", key: key(`api:t:ab${i}`), workspaceId: h.ws, actor: admin, at: T0, memberIds: i % 2 ? [m("ana"), m("bob")] : [m("bob"), m("ana")], amount: 1 as PosInt, reason: "both" }),
      ),
    ];
    const results = await Promise.all(cmds);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await h.app.balances(h.ws, m("ana"))).toEqual({ received: 10, given: 10, redeemable: 15 });
    expect(await h.app.balances(h.ws, m("bob"))).toEqual({ received: 10, given: 10, redeemable: 15 });
  });

  test("S51: reject vs approve on a pending redemption -> one wins, at most one refund (AtMostOneRefund)", async () => {
    await fresh();
    await h.addMember({ id: m("rita"), role: "approver", active: true, dailyLimitOverride: null });
    await fund("ana", 12);
    const rw = await activeReward({ stock: 1 });
    const r = await redeem("ana", rw);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const id = r.value.redemptionId;
    const rs = await Promise.all([transition(id, "reject", approver), transition(id, "approve", admin)]);
    expect(okCount(rs)).toBe(1);
    expect(rs.map(errorCode).filter((c) => c !== null)).toEqual(["illegal_transition"]);
    const state = (await shop().redemption(id))?.state;
    const refunds = (await h.entries()).filter((e) => e.kind === "refund");
    expect(refunds.length === 1).toBe(state === "rejected");
    // UnitsConserved and StockConserved (docs/statecharts/redemption).
    expect(await redeemable("ana")).toBe(12 * refunds.length);
    expect(((await shop().reward(rw))?.stock ?? 0) + (state === "rejected" ? 0 : 1)).toBe(1);
  });

  test("S51 S53: reject vs fulfil and cancel vs fulfil on the same redemption -> one wins, at most one refund", async () => {
    for (let round = 0; round < 4; round++) {
      await fresh();
      await h.addMember({ id: m("rita"), role: "approver", active: true, dailyLimitOverride: null });
      await fund("ana", 12);
      const rw = await activeReward({ stock: 1, autoApprove: true });
      const r = await redeem("ana", rw);
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      const id = r.value.redemptionId;
      expect(r.value.state).toBe("approved");
      const calls = [
        transition(id, "cancel", admin),
        transition(id, "fulfil", approver),
        transition(id, "reject", admin),
        transition(id, "cancel", admin, `api:t:cancel-${round}`),
      ];
      const rs = await Promise.all(round % 2 === 0 ? calls : calls.reverse());
      expect(rs.filter((x) => x.ok && (x.value as { changed: boolean }).changed)).toHaveLength(1);
      const refunds = (await h.entries()).filter((e) => e.kind === "refund").length;
      expect(refunds).toBeLessThanOrEqual(1);
      const state = (await shop().redemption(id))?.state;
      expect(refunds === 1).toBe(state === "cancelled");
      expect(await redeemable("ana")).toBe(12 * refunds);
      expect(((await shop().reward(rw))?.stock ?? 0) + (state === "cancelled" ? 0 : 1)).toBe(1);
      expect(await h.app.ledgerCheck(h.ws)).toMatchObject({ ok: true });
    }
  });

  test("S59 S57: parallel contributions never overshoot the goal and create exactly one group redemption", async () => {
    await fresh();
    const who = ["ana", "bob", "diana", "lind", "giver"];
    for (const w of who) await fund(w, 10);
    const c = await h.app.execute({ type: "CreateCollab", ...base("web:collab"), title: "Team dinner", description: "", goal: 10, deadline: null, autoApprove: false });
    if (!c.ok) throw new Error(JSON.stringify(c.error));
    const rs = await Promise.all(who.map((w) => contribute(w, c.value.collabId, 4)));
    expect(rs.reduce((t, r) => t + (r.ok ? r.value.taken : 0), 0)).toBe(10); // NeverOverGoal + CompletedMeansGoalMet
    expect((await shop().redemptions()).filter((r) => r.collabId === c.value.collabId)).toHaveLength(1); // OneGroupRedemption
    expect((await shop().collab(c.value.collabId))?.phase).toBe("completed");
    expect((await h.events()).filter((e) => (e.type as string) === "collab.completed")).toHaveLength(1);
    let total = 0;
    for (const w of who) total += 10 - (await redeemable(w));
    expect(total).toBe(10); // UnitsConserved
    expect([...(await shop().contributions(c.value.collabId)).values()].reduce((t, n) => t + n, 0)).toBe(10);
    expect(await h.app.ledgerCheck(h.ws)).toMatchObject({ ok: true });
  });

  test("S17: the same Slack event at once on two replicas -> one ledger write, both callers get the same result", async () => {
    await fresh();
    const appB = createApp(createDbPorts(replicaB, { clock: h.ports.clock, ids: { next: (k) => `${k}-b` } }));
    const cmd = give(h.ws, "giver", "ana", 2, "T:C1:dup");
    const [a, b] = await Promise.all([h.app.execute(cmd), appB.execute(cmd)]);
    expect(a?.ok).toBe(true);
    expect({ ...a, replayed: null }).toEqual({ ...b, replayed: null });
    expect([a?.replayed, b?.replayed].sort()).toEqual([false, true]);
    expect(await h.entries()).toHaveLength(1);
    expect(await h.events()).toHaveLength(1);
    expect(await h.commandLog()).toHaveLength(1);
  });

  test("G2: a duplicate claim with no shared lock waits for the first transaction and replays its result", async () => {
    await fresh();
    const portsB = createDbPorts(replicaB, { clock: h.ports.clock });
    const k = "job:claim-race" as CommandKey;
    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((r) => (releaseFirst = r));
    let firstClaimed!: () => void;
    const claimedSignal = new Promise<void>((r) => (firstClaimed = r));
    const commit = { key: k, requestHash: "h", commandType: "Test", actor: admin, at: T0 as Instant, command: {}, decision: accept({ n: 1 }) };

    const first = h.ports.uow.run(h.ws, [], async (tx) => {
      expect(await tx.claim(k, "h")).toEqual({ status: "claimed" });
      firstClaimed();
      await firstMayCommit;
      await tx.commit(commit);
      return "first";
    });
    await claimedSignal;
    const second = portsB.uow.run(h.ws, [], async (tx) => tx.claim(k, "h"));
    await new Promise((r) => setTimeout(r, 150)); // the second claim is now blocked on the uncommitted row
    releaseFirst();
    expect(await first).toBe("first");
    expect(await second).toEqual({ status: "done", requestHash: "h", result: { ok: true, value: { n: 1 } } });
  });

  test("G2: when the first claimant rolls back, the waiting duplicate claims the key itself", async () => {
    await fresh();
    const k = "job:claim-rollback" as CommandKey;
    let firstClaimed!: () => void;
    const claimedSignal = new Promise<void>((r) => (firstClaimed = r));
    const first = h.ports.uow.run(h.ws, [], async (tx) => {
      await tx.claim(k, "h");
      firstClaimed();
      await new Promise((r) => setTimeout(r, 100));
      throw new Error("handler failed");
    });
    await claimedSignal;
    const second = createDbPorts(replicaB).uow.run(h.ws, [], async (tx) => tx.claim(k, "h"));
    await expect(first).rejects.toThrow("handler failed");
    expect(await second).toEqual({ status: "claimed" });
    // The second unit never committed, so its claim was rolled back too: nothing is left behind.
    expect(await h.commandLog()).toEqual([]);
  });

  test("S39: a bulk reset during parallel gifts and a deduction is serialized and never double-deducts", async () => {
    await fresh();
    await h.addMember({ id: m("giver"), role: "member", active: true, dailyLimitOverride: 50 as PosInt });
    await h.app.execute({ type: "GrantBonus", key: key("api:t:seed"), workspaceId: h.ws, actor: admin, at: T0, memberIds: [m("ana")], amount: 5 as PosInt, reason: "seed" });
    const resetCmd = { type: "ResetAllRedeemable", key: key("api:t:reset"), workspaceId: h.ws, actor: admin, at: T0, reason: "new year" } as const;
    const deductCmd = { type: "Deduct", key: key("api:t:deduct"), workspaceId: h.ws, actor: admin, at: T0, memberId: m("ana"), amount: 2 as PosInt, reason: "fix" } as const;
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => h.app.execute(give(h.ws, "giver", "ana"))),
      h.app.execute(resetCmd),
      h.app.execute(deductCmd),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);

    // The reset's deduction for ana equals exactly what ana held before it; everything after it is still there.
    const entries = (await createDbInspector(replicaA).entries(h.ws)).filter((e) => e.memberId === "ana");
    const resetRow = entries.find((e) => e.commandKey === "api:t:reset");
    const sum = (rows: typeof entries) => rows.reduce((t, e) => t + (e.kind === "deduction" ? -e.amount : e.amount), 0);
    const before = entries.filter((e) => e.seq < resetRow!.seq);
    const after = entries.filter((e) => e.seq > resetRow!.seq);
    expect(resetRow?.amount).toBe(sum(before));
    expect((await h.app.balances(h.ws, m("ana"))).redeemable).toBe(sum(after));
    expect(await h.app.ledgerCheck(h.ws)).toMatchObject({ ok: true });
  });

  test("S39: bulk reset during parallel redemptions is serialized: no double spend, nothing left to redeem", async () => {
    await fresh();
    await fund("ana", 36);
    const id = await activeReward();
    const reset = h.app.execute({ type: "ResetAllRedeemable", ...base("api:t:reset-shop"), reason: "new year" });
    const rs = await Promise.all([...Array.from({ length: 4 }, (_, i) => redeem("ana", id, `web:redeem:reset:${i}`)), reset]);
    const redeems = rs.slice(0, 4);
    expect(rs[4]?.ok).toBe(true);
    expect(redeems.filter((r) => !r.ok).every((r) => errorCode(r) === "insufficient_redeemable")).toBe(true);

    // The reset deducted exactly what ana held when it ran; every spend before it came out of that balance.
    const entries = (await h.entries()).filter((e) => e.memberId === "ana");
    const resetRow = entries.find((e) => e.commandKey === "api:t:reset-shop");
    const signed = (e: (typeof entries)[number]) => (e.kind === "spend" || e.kind === "deduction" ? -e.amount : e.amount);
    const before = entries.filter((e) => e.seq < resetRow!.seq).reduce((t, e) => t + signed(e), 0);
    expect(resetRow?.amount).toBe(before);
    expect(entries.filter((e) => e.kind === "spend")).toHaveLength(okCount(redeems));
    expect(await shop().redemptions()).toHaveLength(okCount(redeems));
    expect(await redeemable("ana")).toBe(0);
    expect(await h.app.ledgerCheck(h.ws)).toMatchObject({ ok: true });
  });
});
