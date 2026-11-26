// S6: the Postgres billing store. Webhook events apply once; older reports never overwrite newer ones.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApp, workspacePlan, type Instant, type SubscriptionRecord, type WorkspaceId } from "@propi/app";
import { createDbBilling, createDbPorts, type PrismaClient } from "../src/index.ts";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./pg.ts";
import { T0 } from "./harness.ts";

let db: TestDatabase | undefined;
let pg: PrismaClient | undefined;

beforeAll(async () => {
  if (hasDatabase) {
    db = await createTestDatabase();
    pg = db.client();
    for (const ws of ["ws-b1", "ws-b2", "ws-b3", "ws-b4"]) await pg.$executeRawUnsafe(`INSERT INTO workspace (id, settings) VALUES ($1, '{}'::jsonb)`, ws);
  }
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

const WS = "ws-b1" as WorkspaceId;
const sub = (over: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  workspaceId: WS,
  provider: "polar",
  subscriptionId: "sub_1",
  customerId: "cus_1",
  status: "active",
  currentPeriodEnd: (T0 + 86_400_000) as Instant,
  cancelAtPeriodEnd: false,
  seats: 12,
  sourceUpdatedAt: T0,
  ...over,
});

describe.skipIf(!hasDatabase)("billing store (S6)", () => {
  test("a new workspace has no subscription and is not comped (Free)", async () => {
    expect(await createDbBilling(pg!).account("ws-b2" as WorkspaceId)).toEqual({ subscription: null, comped: false });
  });

  test("S6: an event upserts the subscription; replaying the same event id changes nothing", async () => {
    const billing = createDbBilling(pg!);
    expect(await billing.applySubscriptionEvent({ eventId: "evt_1", type: "subscription.active", receivedAt: T0, subscription: sub() })).toBe("applied");
    const replay = sub({ status: "canceled", sourceUpdatedAt: (T0 + 5) as Instant });
    expect(await billing.applySubscriptionEvent({ eventId: "evt_1", type: "subscription.active", receivedAt: T0, subscription: replay })).toBe("duplicate");
    expect((await billing.account(WS)).subscription).toEqual(sub());
  });

  test("S6: a later event updates the record; an older one is recorded but does not overwrite it", async () => {
    const billing = createDbBilling(pg!);
    const canceled = sub({ cancelAtPeriodEnd: true, sourceUpdatedAt: (T0 + 1000) as Instant });
    expect(await billing.applySubscriptionEvent({ eventId: "evt_2", type: "subscription.canceled", receivedAt: T0, subscription: canceled })).toBe("applied");
    expect(await billing.applySubscriptionEvent({ eventId: "evt_0", type: "subscription.created", receivedAt: T0, subscription: sub({ status: "incomplete" }) })).toBe("stale");
    expect((await billing.account(WS)).subscription).toEqual(canceled);
  });

  test("an event for a workspace that does not exist is ignored", async () => {
    const billing = createDbBilling(pg!);
    expect(await billing.applySubscriptionEvent({ eventId: "evt_x", type: "subscription.active", receivedAt: T0, subscription: sub({ workspaceId: "nope" as WorkspaceId }) })).toBe("unknown_workspace");
  });

  test("S7: comping makes the workspace Pro-equivalent and can be undone", async () => {
    const billing = createDbBilling(pg!);
    await billing.setComped("ws-b2" as WorkspaceId, true);
    const ports = createDbPorts(pg!);
    expect(await workspacePlan({ billing, directory: ports.directory, clock: { now: () => T0 } }, "ws-b2" as WorkspaceId)).toEqual({ plan: "comped", activeMembers: 0, limit: null, overLimit: false });
    await billing.setComped("ws-b2" as WorkspaceId, false);
    expect((await billing.account("ws-b2" as WorkspaceId)).comped).toBe(false);
    // The store plugs into createApp as the plan source.
    expect(createApp(ports, { billing })).toBeDefined();
  });
});

describe.skipIf(!hasDatabase)("billing store one live subscription per workspace (S12a) and seats (S11)", () => {
  const W3 = "ws-b3" as WorkspaceId;
  const W4 = "ws-b4" as WorkspaceId;
  const apply = (billing: ReturnType<typeof createDbBilling>, eventId: string, s: SubscriptionRecord, receivedAt: Instant = T0) =>
    billing.applySubscriptionEvent({ eventId, type: "subscription.updated", receivedAt, subscription: s });

  test("an event for another subscription id never overwrites a live stored one; events for the stored id still apply", async () => {
    const billing = createDbBilling(pg!);
    const live = sub({ workspaceId: W3, subscriptionId: "sub_live", sourceUpdatedAt: T0 });
    expect(await apply(billing, "e3_1", live)).toBe("applied");
    const foreign = sub({ workspaceId: W3, subscriptionId: "sub_other", customerId: "cus_x", seats: 1, sourceUpdatedAt: (T0 + 1000) as Instant });
    expect(await apply(billing, "e3_2", foreign)).toBe("foreign");
    expect((await billing.account(W3)).subscription).toEqual(live);
    const pastDue = sub({ workspaceId: W3, subscriptionId: "sub_live", status: "past_due", sourceUpdatedAt: (T0 + 2000) as Instant });
    expect(await apply(billing, "e3_3", pastDue)).toBe("applied");
    expect(await apply(billing, "e3_4", { ...foreign, sourceUpdatedAt: (T0 + 3000) as Instant })).toBe("foreign");
    // canceled with period left is still live
    const canceled = { ...pastDue, status: "canceled", sourceUpdatedAt: (T0 + 4000) as Instant };
    expect(await apply(billing, "e3_5", canceled)).toBe("applied");
    expect(await apply(billing, "e3_6", { ...foreign, sourceUpdatedAt: (T0 + 5000) as Instant })).toBe("foreign");
    expect((await billing.account(W3)).subscription?.subscriptionId).toBe("sub_live");
  });

  test("once the stored subscription is no longer live, another subscription id applies as today", async () => {
    const billing = createDbBilling(pg!);
    const ended = sub({ workspaceId: W4, subscriptionId: "sub_old", status: "canceled", currentPeriodEnd: (T0 - 1000) as Instant, sourceUpdatedAt: T0 });
    expect(await apply(billing, "e4_1", ended)).toBe("applied");
    const next = sub({ workspaceId: W4, subscriptionId: "sub_new", sourceUpdatedAt: (T0 + 1000) as Instant });
    expect(await apply(billing, "e4_2", next)).toBe("applied");
    expect((await billing.account(W4)).subscription).toEqual(next);
  });

  test("S11: recordSeats stores the seats of the stored subscription id only", async () => {
    const billing = createDbBilling(pg!);
    await billing.recordSeats(W4, "sub_other", 99);
    expect((await billing.account(W4)).subscription?.seats).toBe(12);
    await billing.recordSeats(W4, "sub_new", 15);
    expect((await billing.account(W4)).subscription?.seats).toBe(15);
  });
});
