import { describe, expect, test } from "vitest";
import type { GiftId } from "@propi/core";
import type { EnabledDigestInput, Summarizer } from "@propi/core/insights";
import { WS, admin, m, memberActor } from "../setup.ts";
import { harness, lima } from "../boards/harness.ts";

describe("insights queries", () => {
  test("S88: admins read team metrics for a period; members may not", async () => {
    const h = harness();
    await h.give("giver", ["ana"], 2, { hashtags: ["#ownership"] });
    await h.give("bob", ["ana", "diana"], 1);
    expect(await h.insightsQ.adminMetrics(WS, memberActor("ana"), { kind: "month" })).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    const r = await h.insightsQ.adminMetrics(WS, admin, { kind: "month" }, { usedCents: 0, limitCents: 5000 });
    expect(r).toEqual({
      ok: true,
      value: {
        range: { from: "2026-11-01", to: "2026-11-25" },
        activeMembers: 6,
        gifts: 2,
        units: 4,
        giftsPerCapita: 0.33,
        unitsPerCapita: 0.67,
        giversPercent: 33.3,
        valueTaggedPercent: 50,
        topValues: [{ valueId: "v-own", gifts: 1 }],
        economy: { earned: 4, spent: 0, deducted: 0, outstanding: 4, budget: { usedCents: 0, limitCents: 5000 } },
      },
    });
  });

  test("S89: the weekly isolation job lists active members with nothing received in N weeks, for admins", async () => {
    const h = harness();
    await h.give("giver", ["ana", "bob"], 1, { on: "2026-11-10" });
    await h.give("ana", ["diana"], 1, { on: "2026-11-01" });
    const r = await h.insightsQ.isolationAlerts(WS);
    expect(r.key).toBe("job:isolation:ws-1:2026-W48");
    expect(r.isolated).toEqual(["boss", "diana", "giver", "lind"]);
    expect(r.notifications).toEqual([{ type: "isolation_alert", to: "boss", isolated: ["boss", "diana", "giver", "lind"], weeks: 3 }]);
    h.insights.setSettings(WS, { isolationWeeks: 4 });
    expect((await h.insightsQ.isolationAlerts(WS)).isolated).toEqual(["boss", "giver", "lind"]);
  });

  test("S90: reciprocity flags pairs above the thresholds for admin review, and no gift is blocked", async () => {
    const h = harness();
    h.insights.setSettings(WS, { reciprocity: { minSharePercent: 60, minGifts: 4 } });
    for (const day of ["2026-11-02", "2026-11-03"]) {
      await h.give("ana", ["bob"], 2, { on: day });
      await h.give("bob", ["ana"], 3, { on: day });
    }
    await h.give("ana", ["diana"], 1);
    const r = await h.insightsQ.reciprocity(WS, admin, { kind: "month" });
    expect(r).toEqual({ ok: true, value: [{ a: "ana", b: "bob", aToB: 4, bToA: 6, aSharePercent: 80, bSharePercent: 100, gifts: 4 }] });
    expect(await h.app.balances(WS, m("bob"))).toEqual({ received: 4, given: 6, redeemable: 4 });
    expect((await h.insightsQ.reciprocity(WS, memberActor("bob"), { kind: "month" })).ok).toBe(false);
  });

  test("S91: the monthly digest sends the selected quotes to the summarizer port and keeps only linked quotes", async () => {
    const seen: EnabledDigestInput[] = [];
    const summarizer: Summarizer = {
      async summarize(input) {
        seen.push(input);
        const ids = input.team.flatMap((g) => g.quotes.map((q) => q.giftId));
        return { team: [{ title: "Ownership", summary: "Shipping", valueId: null, giftIds: [...ids, "gift-999" as GiftId] }], members: [] };
      },
    };
    const h = harness({ summarizer });
    await h.give("giver", ["ana"], 2, { hashtags: ["#ownership"], text: "@ana owned the migration :taco::taco:", on: "2026-11-03" });
    await h.give("bob", ["ana"], 1, { text: "@ana thanks :taco:", on: "2026-10-30" });
    const r = await h.insightsQ.monthlyDigest(WS, "2026-11");
    expect(r.key).toBe("job:digest:ws-1:2026-11");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.team).toEqual([{ valueId: "v-own", quotes: [{ giftId: "gift-1", giver: "giver", receivers: ["ana"], units: 2, text: "@ana owned the migration :taco::taco:", valueIds: ["v-own"] }] }]);
    expect(r.summary).toEqual({ team: [{ title: "Ownership", summary: "Shipping", valueId: null, giftIds: ["gift-1"] }], members: [] });
    expect(lima("2026-11-03")).toBeGreaterThan(0);
  });

  test("S91: with message text off the digest is not generated and the summarizer is never called", async () => {
    let calls = 0;
    const h = harness({ settings: { storeMessageText: false }, summarizer: { summarize: async () => (calls++, { team: [], members: [] }) } });
    await h.give("giver", ["ana"], 1);
    const r = await h.insightsQ.monthlyDigest(WS, "2026-11");
    expect(r.input).toEqual({ enabled: false, month: "2026-11", reason: "message_text_off" });
    expect(r.summary).toBeNull();
    expect(calls).toBe(0);
  });
});
