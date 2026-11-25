import { describe, expect, test } from "vitest";
import type { GiftId } from "../../src/shared/types.ts";
import { setPreference } from "../../src/notify/index.ts";
import { adminMetrics, digestInput, isolatedMembers, isolationAlertPlan, linkDigest, reciprocityFlags } from "../../src/insights/index.ts";
import { NOW, d, m, v, world } from "../boards/world.ts";

const team = () => world().member("ana").member("bob").member("cy").member("dee").member("boss", "admin").member("gone", "member", false);
const NOV = { from: d("2026-11-01"), to: d("2026-11-30") };

describe("admin metrics", () => {
  test("S88: totals, per-capita, % who gave, % with a value, top values and shop economy per period", () => {
    const data = team()
      .give({ id: "g1", from: "ana", to: { bob: 3 }, values: ["v-own"] })
      .give({ id: "g2", from: "bob", to: { ana: 1, cy: 1 }, values: ["v-own", "v-fun"] })
      .give({ id: "g3", from: "ana", to: { dee: 2 } })
      .give({ id: "g4", from: "cy", to: { dee: 4 }, values: ["v-fun"] })
      .reverse("g4", "cy", "dee", 4)
      .give({ id: "old", from: "dee", to: { ana: 5 }, on: "2026-10-02" })
      .entry("bonus", "bob", 10)
      .entry("rule_award", "cy", 2)
      .entry("spend", "ana", 4)
      .entry("refund", "ana", 1)
      .entry("deduction", "dee", 1)
      .data();
    expect(adminMetrics(data, NOV, { usedCents: 1500, limitCents: 10000 })).toEqual({
      range: NOV,
      activeMembers: 5,
      gifts: 3,
      units: 7,
      giftsPerCapita: 0.6,
      unitsPerCapita: 1.4,
      giversPercent: 40,
      valueTaggedPercent: 66.7,
      topValues: [
        { valueId: "v-own", gifts: 2 },
        { valueId: "v-fun", gifts: 1 },
      ],
      economy: { earned: 19, spent: 3, deducted: 1, outstanding: 20, budget: { usedCents: 1500, limitCents: 10000 } },
    });
    // Outstanding is everyone's redeemable at the end of the range, history included.
    expect(adminMetrics(data, { from: d("2026-10-01"), to: d("2026-10-31") }, null).economy).toEqual({ earned: 5, spent: 0, deducted: 0, outstanding: 5, budget: null });
  });
});

describe("isolation alert", () => {
  test("S89: an active member who received nothing for N weeks (default 3) is flagged to admins", () => {
    const w = team()
      .give({ id: "g1", from: "ana", to: { bob: 1 }, on: "2026-11-20" })
      .give({ id: "g2", from: "ana", to: { cy: 1 }, on: "2026-11-05" }) // the first day of the 3-week window
      .give({ id: "g3", from: "bob", to: { dee: 1 }, on: "2026-11-04" }) // just outside
      .give({ id: "g4", from: "bob", to: { boss: 2 }, on: "2026-11-24" })
      .reverse("g4", "bob", "boss", 2, "2026-11-24");
    const data = w.data();
    expect(data.insights.isolationWeeks).toBe(3);
    expect(isolatedMembers(data, NOW)).toEqual(["ana", "boss", "dee"]);
    expect(isolatedMembers(data, NOW, 4)).toEqual(["ana", "boss"]);
    expect(isolationAlertPlan(data, new Map(), NOW)).toEqual({
      week: "2026-W48",
      isolated: ["ana", "boss", "dee"],
      notifications: [{ type: "isolation_alert", to: "boss", isolated: ["ana", "boss", "dee"], weeks: 3 }],
    });
    expect(isolationAlertPlan(data, new Map([[m("boss"), setPreference(undefined, "isolation_alert", false)]]), NOW).notifications).toEqual([]);
  });
});

describe("reciprocity", () => {
  test("S90: pairs where >= X% of each one's gifts go to the other, with >= Y gifts, are flagged; nothing is blocked", () => {
    const w = team();
    for (let i = 0; i < 3; i++) w.give({ id: `ab${i}`, from: "ana", to: { bob: 2 } }).give({ id: `ba${i}`, from: "bob", to: { ana: 1 } });
    w.give({ id: "ac", from: "ana", to: { cy: 2 } }); // ana: 6 of 8 units to bob = 75%
    w.give({ id: "cd1", from: "cy", to: { dee: 1 } }).give({ id: "dc1", from: "dee", to: { cy: 1 } }); // 100% each but only 2 gifts
    const data = w.data();
    expect(data.insights.reciprocity).toEqual({ minSharePercent: 50, minGifts: 6 });
    expect(reciprocityFlags(data, NOV)).toEqual([{ a: "ana", b: "bob", aToB: 6, bToA: 3, aSharePercent: 75, bSharePercent: 100, gifts: 6 }]);
    expect(reciprocityFlags(data, NOV, { minSharePercent: 80, minGifts: 2 })).toEqual([{ a: "cy", b: "dee", aToB: 1, bToA: 1, aSharePercent: 100, bSharePercent: 100, gifts: 2 }]);
    expect(reciprocityFlags(data, { from: d("2026-10-01"), to: d("2026-10-31") })).toEqual([]);
  });
});

describe("AI digest input", () => {
  const w = () =>
    team()
      .give({ id: "g1", from: "ana", to: { bob: 3 }, values: ["v-own"], text: "shipped the release" })
      .give({ id: "g2", from: "cy", to: { bob: 1, dee: 1 }, values: ["v-own", "v-fun"], text: "great offsite" })
      .give({ id: "g3", from: "dee", to: { ana: 1 }, text: "thanks for the review" })
      .give({ id: "g4", from: "ana", to: { cy: 1 }, isPrivate: true, text: "secret" })
      .give({ id: "g5", from: "ana", to: { cy: 2 }, text: "reversed" })
      .reverse("g5", "ana", "cy", 2)
      .give({ id: "g6", from: "ana", to: { cy: 1 }, text: "october", on: "2026-10-30" })
      .give({ id: "g7", from: "ana", to: { cy: 1 }, text: null });

  test("S91: the monthly digest input groups stored gift text by value, per team and per member, with quotes linked to gift ids", () => {
    const input = digestInput(w().data(), "2026-11");
    const q = (giftId: string, giver: string, receivers: string[], units: number, text: string, values: string[]) => ({ giftId, giver, receivers, units, text, valueIds: values });
    const g1 = q("g1", "ana", ["bob"], 3, "shipped the release", ["v-own"]);
    const g2 = q("g2", "cy", ["bob", "dee"], 2, "great offsite", ["v-own", "v-fun"]);
    const g3 = q("g3", "dee", ["ana"], 1, "thanks for the review", []);
    expect(input).toEqual({
      enabled: true,
      month: "2026-11",
      team: [
        { valueId: "v-own", quotes: [g1, g2] },
        { valueId: "v-fun", quotes: [g2] },
        { valueId: null, quotes: [g3] },
      ],
      members: [
        { memberId: "ana", groups: [{ valueId: null, quotes: [g3] }] },
        { memberId: "bob", groups: [{ valueId: "v-own", quotes: [g1, g2] }, { valueId: "v-fun", quotes: [g2] }] },
        { memberId: "dee", groups: [{ valueId: "v-fun", quotes: [g2] }, { valueId: "v-own", quotes: [g2] }] },
      ],
    });
  });

  test("S91: with message text off (S70) the digest is disabled", () => {
    expect(digestInput(w().data({ workspace: { storeMessageText: false } }), "2026-11")).toEqual({ enabled: false, month: "2026-11", reason: "message_text_off" });
  });

  test("S91: the summary keeps only quotes that link to gifts in its input", () => {
    const input = digestInput(w().data(), "2026-11");
    if (!input.enabled) throw new Error("expected enabled");
    const linked = linkDigest(
      {
        team: [
          { title: "Ownership", summary: "Releases", valueId: v("v-own"), giftIds: ["g1", "g9", "g4"] as GiftId[] },
          { title: "Made up", summary: "x", valueId: null, giftIds: ["g9"] as GiftId[] },
        ],
        members: [
          { memberId: m("bob"), themes: [{ title: "Ownership", summary: "Bob ships", valueId: v("v-own"), giftIds: ["g1", "g3"] as GiftId[] }] },
          { memberId: m("zed"), themes: [{ title: "Ghost", summary: "?", valueId: null, giftIds: ["g1"] as GiftId[] }] },
        ],
      },
      input,
    );
    expect(linked).toEqual({
      team: [{ title: "Ownership", summary: "Releases", valueId: "v-own", giftIds: ["g1"] }],
      members: [{ memberId: "bob", themes: [{ title: "Ownership", summary: "Bob ships", valueId: "v-own", giftIds: ["g1"] }] }],
    });
  });
});
