import { describe, expect, test } from "vitest";
import { setPreference } from "@propi/core/notify";
import { WS, m } from "../setup.ts";
import { harness, lima } from "../boards/harness.ts";

describe("notification plans", () => {
  test("S83: a gift event plans the giver confirmation and one private notification per receiver", async () => {
    const h = harness();
    await h.give("giver", ["ana", "bob"], 2, { text: "@ana @bob great launch :taco::taco:" });
    const event = h.mem.events(WS)[0]!.event;
    expect(await h.notify.eventNotifications(WS, event)).toEqual([
      { type: "gift_confirmation", to: "giver", giftId: "gift-1", totalCost: 4, remainingAllowance: 1 },
      { type: "gift_received", to: "ana", giftId: "gift-1", giver: "giver", amount: 2, channelId: "C1", text: "@ana @bob great launch :taco::taco:" },
      { type: "gift_received", to: "bob", giftId: "gift-1", giver: "giver", amount: 2, channelId: "C1", text: "@ana @bob great launch :taco::taco:" },
    ]);
  });

  test("S85: per-type preferences silence only that type for that member", async () => {
    const h = harness();
    h.insights.setPreferences(WS, m("ana"), setPreference(undefined, "gift_received", false));
    await h.give("giver", ["ana", "bob"], 1);
    const plan = await h.notify.eventNotifications(WS, h.mem.events(WS)[0]!.event);
    expect(plan.map((n) => [n.type, n.to])).toEqual([["gift_confirmation", "giver"], ["gift_received", "bob"]]);
  });

  test("S84: the weekly report job plans one report per active member who keeps it on, under a job key", async () => {
    const h = harness();
    h.insights.setPreferences(WS, m("lind"), setPreference(undefined, "weekly_report", false));
    await h.give("giver", ["ana"], 1);
    const r = await h.notify.weeklyReports(WS);
    expect(r.key).toBe("job:report:ws-1:2026-W48");
    expect(r.notifications.map((n) => n.to)).toEqual(["giver", "ana", "diana", "bob", "boss"]);
    expect(r.notifications.find((n) => n.to === "ana")?.report.redeemable).toBe(1);
  });

  test("S86: the Friday nudge reminds members with unused allowance this week, and can be turned off", async () => {
    const h = harness();
    expect(await h.notify.nudges(WS)).toBeNull(); // Wednesday
    for (const day of ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]) await h.give("giver", ["ana"], 5, { on: day });
    h.mem.clock.set(lima("2026-11-27", 16));
    const plan = await h.notify.nudges(WS);
    expect(plan?.key).toBe("job:nudge:ws-1:2026-W48");
    expect(plan?.notifications.map((n) => [n.to, n.unused])).toEqual([["ana", 25], ["bob", 25], ["boss", 25], ["diana", 25], ["lind", 25]]);
    h.insights.setSettings(WS, { nudge: { enabled: false, weekday: 5 } });
    expect(await h.notify.nudges(WS)).toBeNull();
  });
});
