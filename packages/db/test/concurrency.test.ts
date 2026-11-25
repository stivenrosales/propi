// G5: the Postgres concurrency acceptance suite. Every case fires its commands with Promise.all
// against real Postgres (advisory locks, READ COMMITTED, claim-first command_log).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { accept, createApp, type CommandKey, type Instant, type PosInt, type WorkspaceId } from "@propi/app";
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

  test.todo("S35: 10 parallel redemptions with redeemable for 3 -> exactly 3 succeed (needs the shop module, T6)");

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

  test.todo("S51: reject vs fulfil on the same redemption -> one wins, at most one refund (needs the shop module, T6)");

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

  test.todo("S39: bulk reset during a redemption -> serialized (needs the shop module, T6)");
});
