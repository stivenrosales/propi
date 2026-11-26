// S6, S7: plan entitlement from the subscription record and the active member count.
import { describe, expect, test } from "vitest";
import { FREE_MEMBER_LIMIT, activeMemberCount, canStartCheckout, planState, seatTarget, type Instant, type SubscriptionRecord, type WorkspaceId } from "../src/index.ts";

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
  test("the Free plan allows up to 5 active members", () => {
    expect(FREE_MEMBER_LIMIT).toBe(5);
    expect(planState({ subscription: null, comped: false }, 5, NOW)).toEqual({ plan: "free", activeMembers: 5, limit: 5, overLimit: false });
  });

  test("a Free workspace with 6 active members is over the limit", () => {
    expect(planState({ subscription: null, comped: false }, 6, NOW)).toEqual({ plan: "free", activeMembers: 6, limit: 5, overLimit: true });
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
    expect(planState({ subscription: revoked, comped: false }, 30, NOW)).toEqual({ plan: "free", activeMembers: 30, limit: 5, overLimit: true });
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

describe("S11 seats follow active members", () => {
  test("an active or trialing Pro subscription targets the active member count when it differs", () => {
    expect(seatTarget({ subscription: sub({ seats: 12 }), comped: false }, 14)).toBe(14);
    expect(seatTarget({ subscription: sub({ status: "trialing", seats: 12 }), comped: false }, 3)).toBe(3);
  });

  test("a subscription set to cancel at period end keeps its seats", () => {
    expect(seatTarget({ subscription: sub({ seats: 12, cancelAtPeriodEnd: true }), comped: false }, 14)).toBeNull();
  });

  test("no update when the seats already match, never below 1 seat", () => {
    expect(seatTarget({ subscription: sub({ seats: 12 }), comped: false }, 12)).toBeNull();
    expect(seatTarget({ subscription: sub({ seats: 1 }), comped: false }, 0)).toBeNull();
    expect(seatTarget({ subscription: sub({ seats: 4 }), comped: false }, 0)).toBe(1);
  });

  test("comped, Free, not seat-based and not active/trialing subscriptions are never synced", () => {
    expect(seatTarget({ subscription: sub(), comped: true }, 30)).toBeNull();
    expect(seatTarget({ subscription: null, comped: false }, 30)).toBeNull();
    expect(seatTarget({ subscription: sub({ seats: null }), comped: false }, 30)).toBeNull();
    for (const status of ["past_due", "canceled", "incomplete", "unpaid"]) expect(seatTarget({ subscription: sub({ status }), comped: false }, 30)).toBeNull();
  });
});

describe("S12a one live subscription per workspace", () => {
  test("checkout is refused while a subscription is live (active, trialing, past_due, canceled with period left)", () => {
    for (const s of [sub(), sub({ status: "trialing" }), sub({ status: "past_due" }), sub({ status: "canceled" })]) expect(canStartCheckout({ subscription: s, comped: false }, NOW)).toBe(false);
  });

  test("checkout is allowed with no subscription or one that is no longer live", () => {
    expect(canStartCheckout({ subscription: null, comped: false }, NOW)).toBe(true);
    expect(canStartCheckout({ subscription: sub({ status: "canceled", currentPeriodEnd: (NOW - DAY) as Instant }), comped: false }, NOW)).toBe(true);
    expect(canStartCheckout({ subscription: sub({ status: "incomplete_expired" }), comped: false }, NOW)).toBe(true);
  });
});
