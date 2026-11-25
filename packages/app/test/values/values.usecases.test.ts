import { describe, expect, test } from "vitest";
import { defaultSettings, type CommandKey, type ValueId } from "@propi/core";
import { defineValue } from "@propi/core/values";
import { T0, WS, admin, key, m, memberActor } from "../setup.ts";
import { harness } from "../boards/harness.ts";

const tag = (by: string, ref: string, emoji: string, k = `slack:react:${ref}:${by}:${emoji}`) =>
  ({ type: "TagGiftByReaction", key: key(k) as CommandKey, workspaceId: WS, actor: memberActor(by), at: T0, messageRef: ref, emoji }) as const;

describe("values", () => {
  test("S41: an admin's value definitions are validated before they are stored", () => {
    const currency = defaultSettings().currency;
    const r = defineValue([], "v-craft" as ValueId, { name: "Craft", hashtag: "craft", emoji: ":hammer:" }, currency);
    expect(r).toEqual({ ok: true, values: [{ id: "v-craft", name: "Craft", hashtag: "#craft", emoji: ":hammer:" }] });
    expect(defineValue([], "v-x" as ValueId, { name: "Taco", hashtag: null, emoji: ":taco:" }, currency)).toEqual({ ok: false, problem: "emoji_is_gift_emoji" });
  });

  test("S42: a gift is tagged by the value's hashtag or emoji in the message", async () => {
    const h = harness();
    await h.give("giver", ["ana"], 1, { hashtags: ["#Ownership"] });
    await h.give("giver", ["bob"], 1, { emojis: [":taco:", ":tada:"] });
    expect(h.mem.gifts(WS).map((g) => g.valueIds)).toEqual([["v-own"], ["v-fun"]]);
  });

  test("S42: any member tags an existing gift later by reacting with a value emoji; the tag reaches the values report", async () => {
    const h = harness();
    await h.give("giver", ["ana"], 2, { ref: "T:C1:900", hashtags: ["#fun"] });
    const first = await h.app.executeAny(tag("diana", "T:C1:900", ":muscle:"));
    expect(first).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", valueId: "v-own", added: true } });
    expect(h.mem.gifts(WS)[0]?.valueIds).toEqual(["v-fun", "v-own"]);
    expect(h.mem.lockLog.at(-1)).toEqual(["gift:T:C1:900"]);
    expect(h.mem.entries(WS)).toHaveLength(1); // no units move
    // The same Slack event again replays; another member's reaction adds nothing new.
    expect(await h.app.executeAny(tag("diana", "T:C1:900", ":muscle:"))).toEqual({ ok: true, replayed: true, value: { giftId: "gift-1", valueId: "v-own", added: true } });
    expect(await h.app.executeAny(tag("bob", "T:C1:900", ":muscle:"))).toEqual({ ok: true, replayed: false, value: { giftId: "gift-1", valueId: "v-own", added: false } });
    expect((await h.boards.valuesReport(WS, { kind: "all" })).map((r) => [r.memberId, r.valueId, r.units])).toEqual([
      ["ana", "v-fun", 2],
      ["ana", "v-own", 2],
    ]);
  });

  test("S42: a non-value emoji, a message without a gift and an inactive member tag nothing", async () => {
    const h = harness();
    await h.give("giver", ["ana"], 1, { ref: "T:C1:901" });
    expect(await h.app.executeAny(tag("bob", "T:C1:901", ":smile:"))).toEqual({ ok: false, replayed: false, error: { code: "not_a_gift" } });
    expect(await h.app.executeAny(tag("bob", "T:C1:404", ":muscle:"))).toEqual({ ok: false, replayed: false, error: { code: "gift_not_found" } });
    expect(await h.app.executeAny(tag("gone", "T:C1:901", ":muscle:"))).toEqual({ ok: false, replayed: false, error: { code: "inactive_member" } });
    expect(h.mem.gifts(WS)[0]?.valueIds).toEqual([]);
    expect(admin.kind).toBe("member");
    expect(m("ana")).toBe("ana");
  });
});
