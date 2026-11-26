// S7: a Free workspace over the member limit keeps gifting but takes no new reward shop redemptions.
import { describe, expect, test } from "vitest";
import { type Directory, type Instant, type MemberRecord, type SubscriptionRecord, type WorkspaceId } from "@propi/core";
import { createApp, syncSeats, workspacePlan } from "../src/index.ts";
import { createMemoryBillingStore } from "../src/testing/index.ts";
import { T0, WS, activeReward, contribute, createCollab, redeem, shopSetup } from "./shop.setup.ts";
import { giveCmd, mention, msg } from "./setup.ts";

// shopSetup has 6 active members (ana, bob, diana, lind, boss, rita) and one deactivated (gone).
const toEleven = ["e1", "e2", "e3", "e4", "e5"];
const toTen = ["e1", "e2", "e3", "e4"];

const proSub = (over: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  workspaceId: WS,
  provider: "polar",
  subscriptionId: "sub_1",
  customerId: "cus_1",
  status: "active",
  currentPeriodEnd: (T0 + 86_400_000) as Instant,
  cancelAtPeriodEnd: false,
  seats: 11,
  sourceUpdatedAt: T0,
  ...over,
});

function billed(members: string[], account: { subscription?: SubscriptionRecord; comped?: boolean } = {}) {
  const s = shopSetup({ members });
  const billing = createMemoryBillingStore();
  if (account.subscription) billing.put(account.subscription);
  if (account.comped) void billing.setComped(WS, true);
  const app = createApp(s.mem.ports, { billing });
  return { ...s, app, billing, run: (cmd: Parameters<typeof s.app.executeAny>[0]) => app.executeAny(cmd) };
}

describe("S7 plan limit on redemptions", () => {
  test("a Free workspace over 10 active members cannot create a redemption", async () => {
    const { run, fund, redeemable } = billed(toEleven);
    const rw = await activeReward(run as never);
    await fund("ana", 20);
    const r = await run(redeem("ana", rw));
    expect(r).toEqual({ ok: false, replayed: false, error: { code: "plan_limit", limit: 10, activeMembers: 11 } });
    expect(await redeemable("ana")).toBe(20);
  });

  test("a Free workspace with 10 active members (deactivated ones not counted) redeems as before", async () => {
    const { run, fund } = billed(toTen);
    const rw = await activeReward(run as never);
    await fund("ana", 20);
    expect((await run(redeem("ana", rw))).ok).toBe(true);
  });

  test("an active Pro subscription and a comped workspace redeem over the limit", async () => {
    for (const account of [{ subscription: proSub() }, { comped: true }]) {
      const { run, fund } = billed(toEleven, account);
      const rw = await activeReward(run as never);
      await fund("ana", 20);
      expect((await run(redeem("ana", rw))).ok).toBe(true);
    }
  });

  test("gifts are never blocked by the plan", async () => {
    const { app } = billed(toEleven);
    const r = await app.execute(giveCmd("ana", msg("@Bob thanks :taco:", [mention("bob")], 1)));
    expect(r.ok).toBe(true);
  });

  test("without a billing store (self-host, billing not configured) redemptions work as before", async () => {
    const { run, fund } = shopSetup({ members: toEleven });
    const rw = await activeReward(run);
    await fund("ana", 20);
    expect((await run(redeem("ana", rw))).ok).toBe(true);
  });

  test("workspacePlan reads the plan state admins see", async () => {
    const { mem, billing } = billed(toEleven);
    expect(await workspacePlan({ billing, directory: mem.ports.directory, clock: mem.ports.clock }, WS)).toEqual({ plan: "free", activeMembers: 11, limit: 10, overLimit: true });
  });
});

describe("S12b plan limit on group reward contributions", () => {
  async function collab(members: string[], account: { subscription?: SubscriptionRecord } = {}) {
    const s = billed(members, account);
    const c = await s.run(createCollab(12));
    if (!c.ok) throw new Error("createCollab failed");
    await s.fund("ana", 20);
    return { ...s, collabId: (c.value as { collabId: string }).collabId };
  }

  test("a Free workspace over 10 active members cannot contribute; nothing is spent", async () => {
    const { run, collabId, redeemable } = await collab(toEleven);
    expect(await run(contribute("ana", collabId, 4))).toEqual({ ok: false, replayed: false, error: { code: "plan_limit", limit: 10, activeMembers: 11 } });
    expect(await redeemable("ana")).toBe(20);
  });

  test("within the limit, or on Pro, contributions work as before", async () => {
    for (const [members, account] of [[toTen, {}], [toEleven, { subscription: proSub() }]] as const) {
      const { run, collabId } = await collab([...members], account);
      expect((await run(contribute("ana", collabId, 4))).ok).toBe(true);
    }
  });
});

describe("S11 seat sync", () => {
  const A = "ws-a" as WorkspaceId;
  const B = "ws-b" as WorkspaceId;
  const C = "ws-c" as WorkspaceId;
  const people = (active: number, inactive = 0): MemberRecord[] =>
    [...Array(active).fill(true), ...Array(inactive).fill(false)].map((on: boolean, i) => ({ id: `m${i}`, active: on }) as unknown as MemberRecord);

  function world(counts: Record<string, MemberRecord[]>, fail: ReadonlySet<string> = new Set()) {
    const billing = createMemoryBillingStore();
    const calls: { subscriptionId: string; seats: number }[] = [];
    const directory = { members: async (ws: WorkspaceId) => counts[ws] ?? [] } as unknown as Directory;
    const seats = {
      async updateSeats(subscriptionId: string, n: number) {
        calls.push({ subscriptionId, seats: n });
        if (fail.has(subscriptionId)) throw new Error("Polar API 500");
      },
    };
    return { billing, calls, run: (wss: WorkspaceId[]) => syncSeats({ billing, directory, clock: { now: () => T0 }, seats }, wss) };
  }

  test("a Pro workspace whose active members differ from its seats is updated in Polar and stored", async () => {
    const w = world({ [A]: people(14, 2) });
    w.billing.put(proSub({ workspaceId: A, subscriptionId: "sub_a", seats: 11 }));
    const r = await w.run([A]);
    expect(w.calls).toEqual([{ subscriptionId: "sub_a", seats: 14 }]);
    expect(r).toEqual({ updated: [{ workspaceId: A, from: 11, to: 14 }], failed: [], unchanged: 0 });
    expect((await w.billing.account(A)).subscription?.seats).toBe(14);
    expect(await w.run([A])).toEqual({ updated: [], failed: [], unchanged: 1 });
    expect(w.calls).toHaveLength(1);
  });

  test("no Polar call when the seats already match, for comped or for Free workspaces", async () => {
    const w = world({ [A]: people(11), [B]: people(30), [C]: people(30) });
    w.billing.put(proSub({ workspaceId: A, subscriptionId: "sub_a", seats: 11 }));
    w.billing.put(proSub({ workspaceId: B, subscriptionId: "sub_b", seats: 2 }));
    await w.billing.setComped(B, true);
    expect(await w.run([A, B, C])).toEqual({ updated: [], failed: [], unchanged: 3 });
    expect(w.calls).toEqual([]);
  });

  test("a Polar error on one workspace is reported and the others still sync; its stored seats stay", async () => {
    const w = world({ [A]: people(5), [B]: people(7) }, new Set(["sub_a"]));
    w.billing.put(proSub({ workspaceId: A, subscriptionId: "sub_a", seats: 3 }));
    w.billing.put(proSub({ workspaceId: B, subscriptionId: "sub_b", seats: 3 }));
    const r = await w.run([A, B]);
    expect(r).toEqual({ updated: [{ workspaceId: B, from: 3, to: 7 }], failed: [{ workspaceId: A, error: "Polar API 500" }], unchanged: 0 });
    expect((await w.billing.account(A)).subscription?.seats).toBe(3);
    expect((await w.billing.account(B)).subscription?.seats).toBe(7);
  });
});
