import { describe, expect, test } from "vitest";
import type { Actor } from "../../src/shared/types.ts";
import {
  authorizeBoard,
  boardsVisibleTo,
  feed,
  isoWeekKey,
  leaderboard,
  rangeOf,
  sameSpanLastMonth,
  tvDisplay,
  valuesReport,
  weeklyReport,
} from "../../src/boards/index.ts";
import { NOW, d, m, v, world } from "./world.ts";

const people = () => world().member("ana").member("bob").member("cy").member("dee").member("boss", "admin").member("gone", "member", false);

describe("timeframes", () => {
  test("S80: today, week, month, year, all-time and custom ranges are local dates in the workspace timezone", () => {
    const tz = "America/Lima";
    expect(rangeOf({ kind: "today" }, NOW, tz)).toEqual({ from: "2026-11-25", to: "2026-11-25" });
    expect(rangeOf({ kind: "week" }, NOW, tz)).toEqual({ from: "2026-11-23", to: "2026-11-25" });
    expect(rangeOf({ kind: "month" }, NOW, tz)).toEqual({ from: "2026-11-01", to: "2026-11-25" });
    expect(rangeOf({ kind: "year" }, NOW, tz)).toEqual({ from: "2026-01-01", to: "2026-11-25" });
    expect(rangeOf({ kind: "all" }, NOW, tz)).toEqual({ from: null, to: null });
    expect(rangeOf({ kind: "custom", from: d("2025-02-01"), to: d("2025-03-31") }, NOW, tz)).toEqual({ from: "2025-02-01", to: "2025-03-31" });
    // 02:00 UTC on the 26th is still the 25th in Lima.
    expect(rangeOf({ kind: "today" }, Date.UTC(2026, 10, 26, 2) as never, tz)).toEqual({ from: "2026-11-25", to: "2026-11-25" });
    expect(isoWeekKey(d("2026-11-25"))).toBe("2026-W48");
    expect(isoWeekKey(d("2027-01-01"))).toBe("2026-W53");
  });
});

describe("leaderboards", () => {
  const w = () =>
    people()
      .give({ id: "g1", from: "ana", to: { bob: 3 } })
      .give({ id: "g2", from: "bob", to: { ana: 1, cy: 1 }, channel: "C2" })
      .give({ id: "g3", from: "cy", to: { bob: 2 }, on: "2026-10-10" })
      .give({ id: "g4", from: "ana", to: { gone: 4 } })
      .give({ id: "g5", from: "gone", to: { dee: 2 } });

  test("S80: received, given and combined boards rank members by net units in the timeframe", () => {
    const data = w().data();
    const month = { kind: "month" } as const;
    expect(leaderboard(data, { board: "received", timeframe: month }, NOW)).toEqual([
      { rank: 1, memberId: "bob", score: 3, received: 3, given: 2 },
      { rank: 2, memberId: "dee", score: 2, received: 2, given: 0 },
      { rank: 3, memberId: "ana", score: 1, received: 1, given: 7 },
      { rank: 3, memberId: "cy", score: 1, received: 1, given: 0 },
    ]);
    expect(leaderboard(data, { board: "given", timeframe: month }, NOW).map((r) => [r.rank, r.memberId, r.score])).toEqual([
      [1, "ana", 7],
      [2, "bob", 2],
    ]);
    expect(leaderboard(data, { board: "combined", timeframe: month }, NOW).map((r) => [r.memberId, r.score])).toEqual([
      ["ana", 8],
      ["bob", 5],
      ["dee", 2],
      ["cy", 1],
    ]);
    expect(leaderboard(data, { board: "received", timeframe: { kind: "all" } }, NOW).find((r) => r.memberId === "bob")?.score).toBe(5);
    expect(leaderboard(data, { board: "received", timeframe: { kind: "custom", from: d("2026-10-01"), to: d("2026-10-31") } }, NOW)).toEqual([
      { rank: 1, memberId: "bob", score: 2, received: 2, given: 0 },
    ]);
  });

  test("S80: a reversal lowers the board and a channel filter keeps only that channel", () => {
    const data = w().reverse("g1", "ana", "bob", 3).data();
    const month = { kind: "month" } as const;
    expect(leaderboard(data, { board: "received", timeframe: month }, NOW).map((r) => r.memberId)).toEqual(["dee", "ana", "cy"]);
    expect(leaderboard(data, { board: "received", timeframe: month, channelId: "C2" }, NOW).map((r) => r.memberId)).toEqual(["ana", "cy"]);
  });

  test("S80: excluded and deactivated members are hidden from every board", () => {
    const data = w().data({ insights: { excludedFromBoards: [m("bob")] } });
    const all = { kind: "all" } as const;
    for (const board of ["received", "given", "combined"] as const) {
      const ids = leaderboard(data, { board, timeframe: all }, NOW).map((r) => r.memberId);
      expect(ids).not.toContain("bob");
      expect(ids).not.toContain("gone");
    }
  });

  test("S81: giver mode shows members only the given board; admins always see all", () => {
    const member: Actor = { kind: "member", memberId: m("ana"), role: "member" };
    const boss: Actor = { kind: "member", memberId: m("boss"), role: "admin" };
    const on = people().data({ insights: { giverMode: true } }).insights;
    const off = people().data().insights;
    expect(boardsVisibleTo(member, on)).toEqual(["given"]);
    expect(boardsVisibleTo(null, on)).toEqual(["given"]);
    expect(boardsVisibleTo(boss, on)).toEqual(["received", "given", "combined"]);
    expect(boardsVisibleTo(member, off)).toEqual(["received", "given", "combined"]);
    expect(authorizeBoard(member, "received", on)).toEqual({ code: "forbidden", need: "admin" });
    expect(authorizeBoard(member, "given", on)).toBeNull();
    expect(authorizeBoard(boss, "combined", on)).toBeNull();
  });

  test("S82: boards filter by value tag", () => {
    const data = people()
      .give({ id: "g1", from: "ana", to: { bob: 3 }, values: ["v-own"] })
      .give({ id: "g2", from: "bob", to: { cy: 5 }, values: ["v-fun"] })
      .give({ id: "g3", from: "cy", to: { dee: 1 }, values: ["v-own", "v-fun"] })
      .data();
    expect(leaderboard(data, { board: "received", timeframe: { kind: "all" }, valueId: v("v-own") }, NOW).map((r) => [r.memberId, r.score])).toEqual([
      ["bob", 3],
      ["dee", 1],
    ]);
    expect(leaderboard(data, { board: "given", timeframe: { kind: "all" }, valueId: v("v-fun") }, NOW).map((r) => [r.memberId, r.score])).toEqual([
      ["bob", 5],
      ["cy", 1],
    ]);
  });
});

describe("values report", () => {
  test("S43: values are reported per member and period (who embodies which value)", () => {
    const data = people()
      .values([{ id: "v-own", name: "Ownership", hashtag: "#ownership" }, { id: "v-fun", name: "Fun", emoji: ":tada:" }])
      .give({ id: "g1", from: "ana", to: { bob: 3 }, values: ["v-own"] })
      .give({ id: "g2", from: "cy", to: { bob: 1, dee: 1 }, values: ["v-own", "v-fun"] })
      .give({ id: "g3", from: "ana", to: { bob: 2 }, values: ["v-own"], on: "2026-10-03" })
      .give({ id: "g4", from: "ana", to: { cy: 2 } })
      .give({ id: "g5", from: "ana", to: { dee: 4 }, values: ["v-fun"] })
      .reverse("g5", "ana", "dee", 4)
      .data();
    expect(valuesReport(data, { from: d("2026-11-01"), to: d("2026-11-30") })).toEqual([
      { memberId: "bob", valueId: "v-own", gifts: 2, units: 4 },
      { memberId: "bob", valueId: "v-fun", gifts: 1, units: 1 },
      { memberId: "dee", valueId: "v-fun", gifts: 1, units: 1 },
      { memberId: "dee", valueId: "v-own", gifts: 1, units: 1 },
    ]);
    expect(valuesReport(data, { from: null, to: null }).find((r) => r.memberId === "bob" && r.valueId === "v-own")).toEqual({ memberId: "bob", valueId: "v-own", gifts: 3, units: 6 });
  });
});

describe("feeds and privacy", () => {
  const w = () =>
    people()
      .give({ id: "g1", from: "ana", to: { bob: 1 }, on: "2026-11-20" })
      .give({ id: "g2", from: "cy", to: { bob: 2 }, isPrivate: true, on: "2026-11-21" })
      .give({ id: "g3", from: "bob", to: { dee: 1 }, on: "2026-11-22" })
      .give({ id: "g4", from: "dee", to: { ana: 1 }, on: "2026-11-23" })
      .reverse("g4", "dee", "ana", 1, "2026-11-23");

  test("S69: private-channel gifts are hidden from feeds and profiles unless the workspace shows them", () => {
    const hidden = w().data();
    expect(feed(hidden, {}).map((i) => i.giftId)).toEqual(["g3", "g1"]);
    expect(feed(hidden, { member: m("bob") }).map((i) => i.giftId)).toEqual(["g3", "g1"]);
    const shown = w().data({ insights: { showPrivateGifts: true } });
    expect(feed(shown, { member: m("bob") }).map((i) => i.giftId)).toEqual(["g3", "g2", "g1"]);
    expect(feed(shown, { limit: 1 })[0]).toEqual({
      giftId: "g3",
      giver: "bob",
      receivers: [{ memberId: "dee", units: 1 }],
      units: 1,
      channelId: "C1",
      text: "thanks g3",
      valueIds: [],
      at: Date.UTC(2026, 10, 22, 15),
    });
  });

  test("S87: the TV display carries the public live feed and the leaderboard", () => {
    const tv = tvDisplay(w().data(), NOW, { feedSize: 2 });
    expect(tv.feed.map((i) => i.giftId)).toEqual(["g3", "g1"]);
    expect(tv.board).toBe("received");
    expect(tv.timeframe).toEqual({ kind: "month" });
    expect(tv.leaderboard.map((r) => [r.memberId, r.score])).toEqual([
      ["bob", 3],
      ["dee", 1],
    ]);
    // Giver mode applies to the public screen too.
    expect(tvDisplay(w().data({ insights: { giverMode: true } }), NOW).board).toBe("given");
  });
});

describe("weekly report", () => {
  test("S84: team totals and own giving vs the same point last month, top givers, who they gave to, redeemable and shop link", () => {
    expect(sameSpanLastMonth(d("2026-11-25"))).toEqual({ from: "2026-10-01", to: "2026-10-25" });
    expect(sameSpanLastMonth(d("2026-03-31"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    const data = people()
      .give({ id: "a1", from: "ana", to: { bob: 2 }, on: "2026-10-05" })
      .give({ id: "a2", from: "bob", to: { cy: 1 }, on: "2026-10-28" }) // after the same point last month
      .give({ id: "b1", from: "ana", to: { bob: 1, cy: 1 }, on: "2026-11-24" })
      .give({ id: "b2", from: "cy", to: { ana: 3 }, on: "2026-11-25" })
      .give({ id: "b3", from: "ana", to: { dee: 1 }, on: "2026-11-02" })
      .entry("bonus", "ana", 10)
      .entry("spend", "ana", 4)
      .data({ insights: { shopUrl: "https://propi.example/shop" } });
    expect(weeklyReport(data, m("ana"), NOW)).toEqual({
      memberId: "ana",
      week: "2026-W48",
      team: { monthToDate: 6, lastMonthSamePoint: 2 },
      topGivers: [
        { memberId: "cy", units: 3 },
        { memberId: "ana", units: 2 },
      ],
      own: { monthToDate: 3, lastMonthSamePoint: 2 },
      gaveTo: [
        { memberId: "bob", units: 1 },
        { memberId: "cy", units: 1 },
      ],
      redeemable: 9,
      shopUrl: "https://propi.example/shop",
    });
  });
});
