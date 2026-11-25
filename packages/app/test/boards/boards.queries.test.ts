import { describe, expect, test } from "vitest";
import type { LocalDate, ValueId } from "@propi/core";
import { WS, admin, m, memberActor } from "../setup.ts";
import { harness } from "./harness.ts";

describe("leaderboard queries", () => {
  test("S80: received/given/combined boards over real gifts, by timeframe and custom range, hiding deactivated and excluded members", async () => {
    const h = harness();
    await h.give("giver", ["ana"], 3);
    await h.give("ana", ["bob"], 2, { channel: { id: "C2", kind: "public" } });
    await h.give("bob", ["ana"], 1, { on: "2026-10-10" });
    await h.give("giver", ["bob"], 1, { on: "2026-11-23" });

    const month = await h.boards.leaderboard(WS, admin, { board: "received", timeframe: { kind: "month" } });
    expect(month).toEqual({
      ok: true,
      value: [
        { rank: 1, memberId: "ana", score: 3, received: 3, given: 2 },
        { rank: 1, memberId: "bob", score: 3, received: 3, given: 0 },
      ],
    });
    const given = await h.boards.leaderboard(WS, admin, { board: "given", timeframe: { kind: "all" } });
    expect(given.ok && given.value.map((r) => [r.memberId, r.score])).toEqual([["giver", 4], ["ana", 2], ["bob", 1]]);
    const combined = await h.boards.leaderboard(WS, admin, { board: "combined", timeframe: { kind: "today" } });
    expect(combined.ok && combined.value.map((r) => [r.memberId, r.score])).toEqual([["ana", 5], ["giver", 3], ["bob", 2]]);
    const custom = await h.boards.leaderboard(WS, admin, { board: "received", timeframe: { kind: "custom", from: "2026-10-01" as LocalDate, to: "2026-10-31" as LocalDate } });
    expect(custom.ok && custom.value.map((r) => [r.memberId, r.score])).toEqual([["ana", 1]]);
    const byChannel = await h.boards.leaderboard(WS, admin, { board: "received", timeframe: { kind: "all" }, channelId: "C2" });
    expect(byChannel.ok && byChannel.value.map((r) => r.memberId)).toEqual(["bob"]);

    // Deactivate bob and exclude giver from boards.
    h.mem.addMember(WS, { id: m("bob"), role: "member", active: false, dailyLimitOverride: null });
    h.insights.setSettings(WS, { excludedFromBoards: [m("giver")] });
    const after = await h.boards.leaderboard(WS, admin, { board: "combined", timeframe: { kind: "all" } });
    expect(after.ok && after.value.map((r) => r.memberId)).toEqual(["ana"]);
  });

  test("S81: in giver mode a member may read only the given board; an admin reads all", async () => {
    const h = harness();
    await h.give("giver", ["ana"], 1);
    h.insights.setSettings(WS, { giverMode: true });
    const member = memberActor("ana");
    expect(await h.boards.visibleBoards(WS, member)).toEqual(["given"]);
    expect(await h.boards.leaderboard(WS, member, { board: "received", timeframe: { kind: "all" } })).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    expect(await h.boards.leaderboard(WS, member, { board: "given", timeframe: { kind: "all" } })).toEqual({ ok: true, value: [{ rank: 1, memberId: "giver", score: 1, received: 0, given: 1 }] });
    expect((await h.boards.leaderboard(WS, admin, { board: "received", timeframe: { kind: "all" } })).ok).toBe(true);
  });

  test("S82: boards filter by value tag", async () => {
    const h = harness();
    await h.give("giver", ["ana"], 2, { hashtags: ["#ownership"] });
    await h.give("giver", ["bob"], 3, { hashtags: ["#fun"] });
    const r = await h.boards.leaderboard(WS, admin, { board: "received", timeframe: { kind: "all" }, valueId: "v-own" as ValueId });
    expect(r.ok && r.value.map((x) => [x.memberId, x.score])).toEqual([["ana", 2]]);
  });
});

describe("values report query", () => {
  test("S43: values received per member for a period", async () => {
    const h = harness();
    await h.give("giver", ["ana"], 2, { hashtags: ["#ownership"] });
    await h.give("bob", ["ana", "diana"], 1, { hashtags: ["#ownership", "#fun"] });
    await h.give("bob", ["ana"], 4, { hashtags: ["#fun"], on: "2026-10-01" });
    expect(await h.boards.valuesReport(WS, { kind: "month" })).toEqual([
      { memberId: "ana", valueId: "v-own", gifts: 2, units: 3 },
      { memberId: "ana", valueId: "v-fun", gifts: 1, units: 1 },
      { memberId: "diana", valueId: "v-fun", gifts: 1, units: 1 },
      { memberId: "diana", valueId: "v-own", gifts: 1, units: 1 },
    ]);
    expect((await h.boards.valuesReport(WS, { kind: "all" })).find((r) => r.memberId === "ana" && r.valueId === "v-fun")?.units).toBe(5);
  });
});

describe("feeds, weekly report and TV", () => {
  test("S69: a private-channel gift is stored and counted but hidden from the feed and profiles until the workspace shows it", async () => {
    const h = harness({ settings: { privateChannelsAllowed: true } });
    await h.give("giver", ["ana"], 1, { on: "2026-11-24" });
    const secret = await h.give("bob", ["ana"], 2, { channel: { id: "G1", kind: "private" } });
    expect(h.mem.gifts(WS).find((g) => g.id === secret.giftId)?.isPrivate).toBe(true);
    expect(await h.app.balances(WS, m("ana"))).toEqual({ received: 3, given: 0, redeemable: 3 });
    expect((await h.boards.feed(WS, {})).map((i) => i.giver)).toEqual(["giver"]);
    expect((await h.boards.profile(WS, m("ana"))).map((i) => i.giver)).toEqual(["giver"]);
    h.insights.setSettings(WS, { showPrivateGifts: true });
    expect((await h.boards.profile(WS, m("ana"))).map((i) => i.giver)).toEqual(["bob", "giver"]);
  });

  test("S84: the weekly report of a member", async () => {
    const h = harness();
    h.insights.setSettings(WS, { shopUrl: "https://propi.example/shop" });
    await h.give("giver", ["ana"], 2, { on: "2026-10-05" });
    await h.give("giver", ["ana", "bob"], 1, { on: "2026-11-24" });
    await h.give("bob", ["giver"], 3);
    const r = await h.boards.weeklyReport(WS, m("giver"));
    expect(r).toEqual({
      memberId: "giver",
      week: "2026-W48",
      team: { monthToDate: 5, lastMonthSamePoint: 2 },
      topGivers: [{ memberId: "bob", units: 3 }, { memberId: "giver", units: 2 }],
      own: { monthToDate: 2, lastMonthSamePoint: 2 },
      gaveTo: [{ memberId: "ana", units: 1 }, { memberId: "bob", units: 1 }],
      redeemable: 3,
      shopUrl: "https://propi.example/shop",
    });
  });

  test("S87: the TV display returns the live feed and the leaderboard", async () => {
    const h = harness();
    await h.give("giver", ["ana"], 2, { on: "2026-11-24" });
    await h.give("bob", ["diana"], 1);
    const tv = await h.boards.tvDisplay(WS, { feedSize: 5 });
    expect(tv.feed.map((i) => [i.giver, i.units])).toEqual([["bob", 1], ["giver", 2]]);
    expect(tv.board).toBe("received");
    expect(tv.leaderboard.map((r) => [r.memberId, r.score])).toEqual([["ana", 2], ["diana", 1]]);
  });
});
