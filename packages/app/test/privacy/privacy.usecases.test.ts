import { describe, expect, test } from "vitest";
import { toCsv } from "@propi/core/privacy";
import { T0, WS, admin, key, m, memberActor } from "../setup.ts";
import { harness, lima } from "../boards/harness.ts";

describe("text-off mode", () => {
  test("S70: with message text off a gift keeps amount, people, channel, time and value tags, but no text", async () => {
    const h = harness({ settings: { storeMessageText: false } });
    const r = await h.give("giver", ["ana"], 2, { hashtags: ["#ownership"], text: "@ana secret words :taco::taco: #ownership" });
    expect(h.mem.gifts(WS)[0]).toMatchObject({ id: r.giftId, giver: "giver", channelId: "C1", text: null, valueIds: ["v-own"], createdAt: T0 });
    expect(h.mem.entries(WS).map((e) => [e.memberId, e.amount, e.reason])).toEqual([["ana", 2, null]]);
    expect(await h.boards.valuesReport(WS, { kind: "all" })).toEqual([{ memberId: "ana", valueId: "v-own", gifts: 1, units: 2 }]);
    // Tagging later still works without text.
    await h.give("giver", ["bob"], 1, { ref: "T:C1:t1" });
    const tagLater = { type: "TagGiftByReaction", key: key("slack:react:t1:ana:muscle"), workspaceId: WS, actor: memberActor("ana"), at: T0, messageRef: "T:C1:t1", emoji: ":muscle:" } as const;
    expect((await h.app.executeAny(tagLater)).ok).toBe(true);
    expect(h.mem.gifts(WS)[1]).toMatchObject({ text: null, valueIds: ["v-own"] });
  });
});

describe("export", () => {
  test("S71: an admin exports gifts, ledger, redemptions and members as CSV with no date cap; members may not", async () => {
    const h = harness();
    await h.give("giver", ["ana"], 1, { on: "2021-03-04", text: "old, \"classic\" gift" });
    await h.give("bob", ["diana"], 2);
    h.insights.addRedemption(WS, { id: "r1", memberId: m("ana"), rewardId: "rw1", cost: 1, state: "fulfilled", createdAt: lima("2022-01-01") });
    expect(await h.privacy.exportAll(WS, memberActor("ana"))).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    const r = await h.privacy.exportAll(WS, admin);
    if (!r.ok) throw new Error("export refused");
    expect(r.value.tables.gifts).toHaveLength(3);
    expect(r.value.tables.ledger.slice(1).map((row) => [row[3], row[5], row[6], row[11]])).toEqual([
      ["gift", "ana", "giver", "2021-03-04T15:00:00.000Z"],
      ["gift", "diana", "bob", "2026-11-25T15:00:00.000Z"],
    ]);
    expect(r.value.tables.redemptions[1]).toEqual(["r1", "ana", "rw1", "1", "fulfilled", "2022-01-01T15:00:00.000Z", "1"]); // S2: quantity column, 1 for rows without one
    expect(r.value.tables.members.slice(1).map((row) => row[0])).toEqual(["ana", "bob", "boss", "diana", "giver", "gone", "lind"]);
    expect(r.value.csv.gifts).toBe(toCsv(r.value.tables.gifts));
    expect(r.value.csv.gifts).toContain('"old, ""classic"" gift"');
  });
});

describe("uninstall", () => {
  test("S72: uninstalling never deletes data; deletion is a separate command with an explicit confirmation", async () => {
    const h = harness();
    await h.give("giver", ["ana"], 2);
    const before = { entries: h.mem.entries(WS), gifts: h.mem.gifts(WS) };
    const uninstall = await h.app.executeAny({ type: "Uninstall", key: key("slack:uninstall:T1"), workspaceId: WS, actor: { kind: "system", job: "slack:app_uninstalled" }, at: T0 });
    expect(uninstall).toEqual({ ok: true, replayed: false, value: { dataRetained: true } });
    expect(h.mem.entries(WS)).toEqual(before.entries);
    expect(h.mem.gifts(WS)).toEqual(before.gifts);
    expect(await h.app.balances(WS, m("ana"))).toEqual({ received: 2, given: 0, redeemable: 2 });

    const del = (k: string, confirmation: string, actor = admin) => h.app.executeAny({ type: "DeleteWorkspaceData", key: key(k), workspaceId: WS, actor, at: T0, confirmation } as never);
    expect(await del("web:delete:0", "delete ws-1", memberActor("ana"))).toEqual({ ok: false, replayed: false, error: { code: "forbidden", need: "admin" } });
    expect(await del("web:delete:1", "yes")).toEqual({ ok: true, replayed: false, value: { status: "confirmation_required", expected: "delete ws-1" } });
    expect(await del("web:delete:2", "delete ws-1")).toEqual({ ok: true, replayed: false, value: { status: "deletion_authorized", workspaceId: "ws-1" } });
    // The decision itself removes nothing; the owner-role adapter does, after this authorization.
    expect(h.mem.entries(WS)).toEqual(before.entries);
  });
});
