import { describe, expect, test } from "vitest";
import type { DomainEvent } from "../../src/shared/decision.ts";
import type { GiftId, PosInt } from "../../src/shared/types.ts";
import { NOTIFICATION_TYPES, nudgeDue, nudgePlan, planEventNotifications, setPreference, wants, weeklyReportPlan } from "../../src/notify/index.ts";
import { NOW, lima, m, world } from "../boards/world.ts";

const given = (over: Partial<Extract<DomainEvent, { type: "gift.given" }>> = {}): DomainEvent => ({
  type: "gift.given",
  giftId: "g1" as GiftId,
  giver: m("ana"),
  receivers: [m("bob"), m("cy")],
  perReceiver: 2,
  totalCost: 4,
  remainingAllowance: 1,
  source: "message",
  ...over,
});

describe("receiver notifications", () => {
  test("S83: each receiver gets a private notification with the giver, amount, channel and message", () => {
    const data = world().member("ana").member("bob").member("cy").give({ id: "g1", from: "ana", to: { bob: 2, cy: 2 }, channel: "C7", text: "great demo :taco::taco:" }).data();
    const plan = planEventNotifications(given(), { gift: data.gifts[0] ?? null, preferences: new Map(), members: new Set([m("ana"), m("bob"), m("cy")]) });
    expect(plan).toEqual([
      { type: "gift_confirmation", to: "ana", giftId: "g1", totalCost: 4, remainingAllowance: 1 },
      { type: "gift_received", to: "bob", giftId: "g1", giver: "ana", amount: 2, channelId: "C7", text: "great demo :taco::taco:" },
      { type: "gift_received", to: "cy", giftId: "g1", giver: "ana", amount: 2, channelId: "C7", text: "great demo :taco::taco:" },
    ]);
  });

  test("S83: with message text off the notification carries no text; a bot giver gets no confirmation", () => {
    const data = world().give({ id: "g1", from: "bot:B1", to: { bob: 1 }, text: null }).data();
    const plan = planEventNotifications(given({ giver: m("bot:B1"), receivers: [m("bob")], perReceiver: 1, totalCost: 1, remainingAllowance: 4 }), {
      gift: data.gifts[0] ?? null,
      preferences: new Map(),
      members: new Set([m("bob")]),
    });
    expect(plan).toEqual([{ type: "gift_received", to: "bob", giftId: "g1", giver: "bot:B1", amount: 1, channelId: "C1", text: null }]);
  });

  test("S85: each member turns each notification type on or off", () => {
    expect(NOTIFICATION_TYPES).toEqual(["gift_received", "gift_confirmation", "gift_rejected", "weekly_report", "nudge", "isolation_alert", "adjustment"]);
    let prefs = setPreference(undefined, "gift_received", false);
    expect(wants(prefs, "gift_received")).toBe(false);
    expect(wants(prefs, "nudge")).toBe(true);
    prefs = setPreference(prefs, "gift_received", true);
    expect(wants(prefs, "gift_received")).toBe(true);

    const data = world().give({ id: "g1", from: "ana", to: { bob: 2, cy: 2 } }).data();
    const preferences = new Map([
      [m("bob"), setPreference(undefined, "gift_received", false)],
      [m("ana"), setPreference(undefined, "gift_confirmation", false)],
    ]);
    const plan = planEventNotifications(given(), { gift: data.gifts[0] ?? null, preferences, members: new Set([m("ana"), m("bob"), m("cy")]) });
    expect(plan.map((n) => [n.type, n.to])).toEqual([["gift_received", "cy"]]);

    const rejected: DomainEvent = { type: "gift.rejected", giver: m("ana"), error: { code: "over_allowance", cost: 6, remaining: 5 } };
    expect(planEventNotifications(rejected, { gift: null, preferences: new Map(), members: new Set([m("ana")]) })).toEqual([
      { type: "gift_rejected", to: "ana", error: { code: "over_allowance", cost: 6, remaining: 5 } },
    ]);
    const adj: DomainEvent = { type: "adjustment.made", kind: "bonus", memberIds: [m("ana"), m("bob")], amount: 5 as PosInt, reason: "launch" };
    expect(planEventNotifications(adj, { gift: null, preferences: new Map([[m("bob"), setPreference(undefined, "adjustment", false)]]), members: new Set([m("ana"), m("bob")]) })).toEqual([
      { type: "adjustment", to: "ana", kind: "bonus", amount: 5, reason: "launch" },
    ]);
  });

  test("S84, S85: the weekly report goes to every active member who keeps it on", () => {
    const data = world().member("ana").member("bob").member("gone", "member", false).give({ id: "g1", from: "ana", to: { bob: 1 } }).data();
    const plan = weeklyReportPlan(data, new Map([[m("bob"), setPreference(undefined, "weekly_report", false)]]), NOW);
    expect(plan.map((n) => [n.type, n.to, n.report.week])).toEqual([["weekly_report", "ana", "2026-W48"]]);
  });
});

describe("weekly nudge", () => {
  test("S86: on the nudge weekday, members with unused allowance this week are reminded", () => {
    const friday = lima("2026-11-27");
    expect(nudgeDue(NOW, world().data())).toBeNull(); // Wednesday
    expect(nudgeDue(friday, world().data())).toBe("2026-W48");
    expect(nudgeDue(friday, world().data({ insights: { nudge: { enabled: false, weekday: 5 } } }))).toBeNull();
    expect(nudgeDue(NOW, world().data({ insights: { nudge: { enabled: true, weekday: 3 } } }))).toBe("2026-W48");

    // Week Mon 23..Fri 27, limit 5/day -> 25 units of capacity so far.
    const w = world().member("ana").member("bob").member("cy").member("gone", "member", false);
    for (const day of ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]) w.give({ id: `a-${day}`, from: "ana", to: { bob: 5 }, on: day });
    w.give({ id: "b1", from: "bob", to: { cy: 3 }, on: "2026-11-24" }).give({ id: "b0", from: "bob", to: { cy: 5 }, on: "2026-11-20" });
    const plan = nudgePlan(w.data(), new Map([[m("cy"), setPreference(undefined, "nudge", false)]]), friday);
    expect(plan).toEqual({
      week: "2026-W48",
      notifications: [{ type: "nudge", to: "bob", week: "2026-W48", unused: 22 }],
    });
    expect(nudgePlan(w.data(), new Map(), NOW)).toBeNull();
  });
});
