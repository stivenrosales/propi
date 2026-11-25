// S7: a Free workspace over the member limit keeps gifting but takes no new reward shop redemptions.
import { describe, expect, test } from "vitest";
import { type Instant, type SubscriptionRecord } from "@propi/core";
import { createApp, workspacePlan } from "../src/index.ts";
import { createMemoryBillingStore } from "../src/testing/index.ts";
import { T0, WS, activeReward, redeem, shopSetup } from "./shop.setup.ts";
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
