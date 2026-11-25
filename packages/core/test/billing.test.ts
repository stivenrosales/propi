// S6, S7: plan entitlement from the subscription record and the active member count.
import { describe, expect, test } from "vitest";
import { FREE_MEMBER_LIMIT, activeMemberCount, planState, type Instant, type SubscriptionRecord, type WorkspaceId } from "../src/index.ts";

const NOW = Date.UTC(2026, 10, 25) as Instant;
const DAY = 86_400_000;
const sub = (over: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  workspaceId: "ws-1" as WorkspaceId,
  provider: "polar",
  subscriptionId: "sub_1",
  customerId: "cus_1",
  status: "active",
  currentPeriodEnd: (NOW + 10 * DAY) as Instant,
  cancelAtPeriodEnd: false,
  seats: 12,
  sourceUpdatedAt: NOW,
  ...over,
});

describe("S7 entitlement", () => {
  test("the Free plan allows up to 10 active members", () => {
    expect(FREE_MEMBER_LIMIT).toBe(10);
    expect(planState({ subscription: null, comped: false }, 10, NOW)).toEqual({ plan: "free", activeMembers: 10, limit: 10, overLimit: false });
  });

  test("a Free workspace with 11 active members is over the limit", () => {
    expect(planState({ subscription: null, comped: false }, 11, NOW)).toEqual({ plan: "free", activeMembers: 11, limit: 10, overLimit: true });
  });

  test("an active Pro subscription lifts the limit", () => {
    expect(planState({ subscription: sub(), comped: false }, 500, NOW)).toEqual({ plan: "pro", activeMembers: 500, limit: null, overLimit: false });
  });

  test("a Pro subscription canceled at period end stays Pro until the period ends", () => {
    const canceled = sub({ cancelAtPeriodEnd: true });
    expect(planState({ subscription: canceled, comped: false }, 30, NOW).plan).toBe("pro");
    // Polar may also report status "canceled" before the period ends.
    expect(planState({ subscription: sub({ status: "canceled", cancelAtPeriodEnd: true }), comped: false }, 30, NOW).plan).toBe("pro");
  });

  test("a revoked subscription (canceled, period over) falls back to Free", () => {
    const revoked = sub({ status: "canceled", currentPeriodEnd: (NOW - DAY) as Instant });
    expect(planState({ subscription: revoked, comped: false }, 30, NOW)).toEqual({ plan: "free", activeMembers: 30, limit: 10, overLimit: true });
    expect(planState({ subscription: sub({ status: "unpaid" }), comped: false }, 30, NOW).plan).toBe("free");
    expect(planState({ subscription: sub({ status: "incomplete" }), comped: false }, 30, NOW).plan).toBe("free");
  });

  test("a comped workspace is treated as Pro and never over the limit", () => {
    expect(planState({ subscription: null, comped: true }, 300, NOW)).toEqual({ plan: "comped", activeMembers: 300, limit: null, overLimit: false });
  });

  test("active members are the members not deactivated", () => {
    expect(activeMemberCount([{ active: true }, { active: false }, { active: true }])).toBe(2);
  });
});
