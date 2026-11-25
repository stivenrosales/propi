import { describe, expect, test } from "vitest";
import { defaultSettings } from "../../src/workspace/settings.ts";
import { matchValues, type Value } from "../../src/values/values.ts";
import type { Gift } from "../../src/giving/types.ts";
import type { CommandKey, GiftId, Instant, PosInt, ValueId, WorkspaceId } from "../../src/shared/types.ts";
import { decideTagByReaction, defineValue, valueForEmoji, type TagGiftByReaction } from "../../src/values/index.ts";
import { NOW, m } from "../boards/world.ts";

const own: Value = { id: "v-own" as ValueId, name: "Ownership", hashtag: "#ownership", emoji: ":muscle:" };
const currency = { ...defaultSettings().currency, extraEmojis: new Map([[":fire:", 3 as PosInt]]) };

describe("value definitions", () => {
  test("S41: an admin defines values with a name, an optional hashtag and an optional emoji", () => {
    expect(defineValue([], "v-own" as ValueId, { name: " Ownership ", hashtag: "Ownership", emoji: ":muscle:" }, currency)).toEqual({ ok: true, values: [own] });
    expect(defineValue([own], "v-fun" as ValueId, { name: "Fun", hashtag: null, emoji: null }, currency)).toEqual({
      ok: true,
      values: [own, { id: "v-fun", name: "Fun", hashtag: null, emoji: null }],
    });
    // Redefining an id replaces it in place.
    expect(defineValue([own], "v-own" as ValueId, { name: "Owner", hashtag: "#owner", emoji: null }, currency)).toEqual({
      ok: true,
      values: [{ id: "v-own", name: "Owner", hashtag: "#owner", emoji: null }],
    });
  });

  test("S41: names, hashtags and emojis are unique, hashtags are words, and a value emoji is never a gift emoji", () => {
    const def = (input: { name: string; hashtag: string | null; emoji: string | null }) => defineValue([own], "v-x" as ValueId, input, currency);
    expect(def({ name: " ", hashtag: null, emoji: null })).toEqual({ ok: false, problem: "name_required" });
    expect(def({ name: "ownership", hashtag: null, emoji: null })).toEqual({ ok: false, problem: "duplicate_name" });
    expect(def({ name: "X", hashtag: "#OWNERSHIP", emoji: null })).toEqual({ ok: false, problem: "duplicate_hashtag" });
    expect(def({ name: "X", hashtag: "#two words", emoji: null })).toEqual({ ok: false, problem: "invalid_hashtag" });
    expect(def({ name: "X", hashtag: null, emoji: ":muscle:" })).toEqual({ ok: false, problem: "duplicate_emoji" });
    expect(def({ name: "X", hashtag: null, emoji: ":taco:" })).toEqual({ ok: false, problem: "emoji_is_gift_emoji" });
    expect(def({ name: "X", hashtag: null, emoji: ":fire:" })).toEqual({ ok: false, problem: "emoji_is_gift_emoji" });
  });
});

describe("tagging", () => {
  test("S42: a message tags a gift through the value's hashtag or its emoji", () => {
    const fun: Value = { id: "v-fun" as ValueId, name: "Fun", hashtag: null, emoji: ":tada:" };
    expect(matchValues(["#Ownership"], [], [own, fun])).toEqual(["v-own"]);
    expect(matchValues([], [":taco:", ":tada:"], [own, fun])).toEqual(["v-fun"]);
    expect(valueForEmoji(":muscle:", [own, fun])).toEqual(own);
    expect(valueForEmoji(":taco:", [own, fun])).toBeNull();
  });

  const gift: Gift = {
    id: "g1" as GiftId,
    giver: m("ana"),
    messageRef: "T:C1:1",
    source: "message",
    emoji: null,
    channelId: "C1",
    isPrivate: false,
    text: null,
    valueIds: [],
    allowanceDay: null,
    createdAt: NOW,
    closedBy: null,
  };
  const cmd = (emoji: string, by = "cy"): TagGiftByReaction => ({
    type: "TagGiftByReaction",
    key: `slack:tag:T:C1:1:${by}:${emoji}` as CommandKey,
    workspaceId: "ws-1" as WorkspaceId,
    actor: { kind: "member", memberId: m(by), role: "member" },
    at: NOW as Instant,
    messageRef: "T:C1:1",
    emoji,
  });
  const snap = (over: Partial<Parameters<typeof decideTagByReaction>[0]> = {}) => ({
    gift,
    values: [own],
    tagger: { id: m("cy"), role: "member" as const, active: true, dailyLimitOverride: null },
    ...over,
  });

  test("S42: any member adds a value to an existing gift later by reacting with the value's emoji", () => {
    const d = decideTagByReaction(snap(), cmd(":muscle:"), NOW);
    expect(d.outcome).toEqual({ ok: true, value: { giftId: "g1", valueId: "v-own", added: true } });
    expect(d.entries).toEqual([]);
    expect(d.writes).toEqual([{ t: "gift.upsert", gift: { ...gift, valueIds: ["v-own"] } }]);
    // Already tagged: nothing to write.
    const again = decideTagByReaction(snap({ gift: { ...gift, valueIds: ["v-own" as ValueId] } }), cmd(":muscle:"), NOW);
    expect(again.outcome).toEqual({ ok: true, value: { giftId: "g1", valueId: "v-own", added: false } });
    expect(again.writes).toEqual([]);
  });

  test("S42: a reaction that is no value emoji, on no gift, or by an inactive member tags nothing", () => {
    expect(decideTagByReaction(snap(), cmd(":smile:"), NOW).outcome).toEqual({ ok: false, error: { code: "not_a_gift" } });
    expect(decideTagByReaction(snap({ gift: null }), cmd(":muscle:"), NOW).outcome).toEqual({ ok: false, error: { code: "gift_not_found" } });
    expect(decideTagByReaction(snap({ tagger: { id: m("cy"), role: "member", active: false, dailyLimitOverride: null } }), cmd(":muscle:"), NOW).outcome).toEqual({
      ok: false,
      error: { code: "inactive_member" },
    });
    expect(decideTagByReaction(snap({ tagger: null }), cmd(":muscle:"), NOW).outcome).toEqual({ ok: false, error: { code: "unknown_member", memberId: "cy" } });
  });
});
