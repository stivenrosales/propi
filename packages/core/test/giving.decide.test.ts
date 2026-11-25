import { describe, expect, test } from "vitest";
import {
  decideDeleteMessage,
  decideEditMessage,
  decideGiveByMessage,
  decideGiveByReaction,
  decideRemoveReaction,
  reactionKey,
  type Gift,
  type GiveByMessage,
  type GiveByReaction,
  type GiveSnapshot,
  type LocalDate,
  type MemberId,
} from "../src/index.ts";
import { NOON_LIMA, WS, at, gid, key, m, memberActor, mention, message, record, settings } from "./fixtures.ts";

const TODAY = "2026-11-25" as LocalDate;
const active = new Set(["lind", "ana", "diana", "giver"].map(m));

const snap = (over: Partial<GiveSnapshot> = {}): GiveSnapshot => ({
  settings: settings(),
  giverRecord: record("giver"),
  activeMembers: active,
  values: [],
  allowanceUsed: 0,
  newGiftId: gid("g-new"),
  ...over,
});

const give = (over: Partial<GiveByMessage> = {}): GiveByMessage => ({
  type: "GiveByMessage",
  key: key("slack:msg:T:C1:1"),
  workspaceId: WS,
  actor: memberActor("giver"),
  at: NOON_LIMA,
  messageRef: "T:C1:1",
  message: message({ text: "@Ana @Diana gracias :taco::taco:", mentions: [mention("ana"), mention("diana")], emojiTokens: [":taco:", ":taco:"] }),
  ...over,
});

const existingGift = (over: Partial<Gift> = {}): Gift => ({
  id: gid("g1"),
  giver: m("giver"),
  messageRef: "T:C1:1",
  source: "message",
  emoji: null,
  channelId: "C1",
  isPrivate: false,
  text: "old",
  valueIds: [],
  allowanceDay: TODAY,
  createdAt: NOON_LIMA,
  closedBy: null,
  ...over,
});

describe("decideGiveByMessage", () => {
  test("S10: a successful gift writes one entry per receiver and reports cost and remaining allowance", () => {
    const d = decideGiveByMessage(snap({ allowanceUsed: 1 }), give(), NOON_LIMA);
    expect(d.outcome).toEqual({
      ok: true,
      value: { giftId: "g-new", receivers: ["ana", "diana"], perReceiver: 2, totalCost: 4, remainingAllowance: 0 },
    });
    expect(d.entries).toEqual([
      { kind: "gift", amount: 2, memberId: "ana", counterpartId: "giver", cause: { type: "gift", giftId: "g-new" }, source: "message", allowanceDay: TODAY, reason: "@Ana @Diana gracias :taco::taco:" },
      { kind: "gift", amount: 2, memberId: "diana", counterpartId: "giver", cause: { type: "gift", giftId: "g-new" }, source: "message", allowanceDay: TODAY, reason: "@Ana @Diana gracias :taco::taco:" },
    ]);
  });

  test("S13: over the allowance no units move and the giver gets a notice with cost and remaining", () => {
    const d = decideGiveByMessage(snap({ allowanceUsed: 3 }), give(), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: false, error: { code: "over_allowance", cost: 4, remaining: 2 } });
    expect(d.entries).toEqual([]);
    expect(d.writes).toEqual([]);
    expect(d.events).toEqual([{ type: "gift.rejected", giver: "giver", error: { code: "over_allowance", cost: 4, remaining: 2 } }]);
  });

  test("S14: the whole message text is the gift reason; S70 off stores no text", () => {
    const d = decideGiveByMessage(snap(), give(), NOON_LIMA);
    expect(d.writes).toEqual([
      {
        t: "gift.upsert",
        gift: { id: "g-new", giver: "giver", messageRef: "T:C1:1", source: "message", emoji: null, channelId: "C1", isPrivate: false, text: "@Ana @Diana gracias :taco::taco:", valueIds: [], allowanceDay: TODAY, createdAt: NOON_LIMA, closedBy: null },
      },
    ]);
    const hidden = decideGiveByMessage(snap({ settings: settings({ storeMessageText: false }) }), give(), NOON_LIMA);
    expect(hidden.writes[0]?.t === "gift.upsert" && hidden.writes[0].gift.text).toBeNull();
    expect(hidden.entries.every((e) => e.reason === null)).toBe(true);
  });

  test("S29: a successful gift emits gift.given carrying the remaining allowance", () => {
    const d = decideGiveByMessage(snap({ allowanceUsed: 1 }), give(), NOON_LIMA);
    expect(d.events).toEqual([
      { type: "gift.given", giftId: "g-new", giver: "giver", receivers: ["ana", "diana"], perReceiver: 2, totalCost: 4, remainingAllowance: 0, source: "message" },
    ]);
  });

  test("S7: a deactivated giver cannot give", () => {
    const d = decideGiveByMessage(snap({ giverRecord: record("giver", { active: false }) }), give(), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: false, error: { code: "inactive_member" } });
    expect(d.entries).toEqual([]);
  });
});

const react = (over: Partial<GiveByReaction> = {}): GiveByReaction => ({
  type: "GiveByReaction",
  key: key("slack:react:T:C1:1:giver::taco:"),
  workspaceId: WS,
  actor: memberActor("giver"),
  at: NOON_LIMA,
  messageRef: "T:C1:1",
  emoji: ":taco:",
  channel: { id: "C1", kind: "public" },
  target: { author: m("lind"), mentions: [] },
  ...over,
});

describe("reaction deciders", () => {
  test("S18: a reaction gives the emoji value to the mentioned people, else to the author", () => {
    const toAuthor = decideGiveByReaction({ ...snap(), alreadyGifted: false, closedByAdmin: false }, react(), NOON_LIMA);
    expect(toAuthor.outcome).toEqual({ ok: true, value: { giftId: "g-new", receivers: ["lind"], perReceiver: 1, totalCost: 1, remainingAllowance: 4 } });
    expect(toAuthor.entries[0]).toMatchObject({ kind: "gift", memberId: "lind", counterpartId: "giver", source: "reaction", allowanceDay: TODAY });
    const toMentions = decideGiveByReaction({ ...snap(), alreadyGifted: false, closedByAdmin: false }, react({ target: { author: m("lind"), mentions: [mention("ana"), mention("diana")] } }), NOON_LIMA);
    expect(toMentions.outcome.ok && toMentions.outcome.value.receivers).toEqual(["ana", "diana"]);
    const off = decideGiveByReaction({ ...snap({ settings: settings({ reactionsEnabled: false }) }), alreadyGifted: false, closedByAdmin: false }, react(), NOON_LIMA);
    expect(off.outcome).toEqual({ ok: false, error: { code: "not_a_gift" } });
    const notGiftEmoji = decideGiveByReaction({ ...snap(), alreadyGifted: false, closedByAdmin: false }, react({ emoji: ":smile:" }), NOON_LIMA);
    expect(notGiftEmoji.outcome).toEqual({ ok: false, error: { code: "not_a_gift" } });
  });

  test("S19: a reaction gift consumes the reactor's allowance", () => {
    const d = decideGiveByReaction({ ...snap({ allowanceUsed: 5 }), alreadyGifted: false, closedByAdmin: false }, react(), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: false, error: { code: "over_allowance", cost: 1, remaining: 0 } });
    expect(d.entries).toEqual([]);
  });

  test("S20: one reaction gift per (giver, message, emoji); G8 adds an occurrence counter to the key", () => {
    const d = decideGiveByReaction({ ...snap(), alreadyGifted: true, closedByAdmin: false }, react(), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: false, error: { code: "not_a_gift" } });
    expect(d.entries).toEqual([]);
    expect(reactionKey(key("slack:react:T:C1:1:giver::taco:"), 0)).toBe("slack:react:T:C1:1:giver::taco::0");
    expect(reactionKey(key("slack:react:T:C1:1:giver::taco:"), 2)).toBe("slack:react:T:C1:1:giver::taco::2");
  });

  test("S38: a reaction gift an admin reversed is final; the giver cannot give it again on that message and emoji", () => {
    const d = decideGiveByReaction({ ...snap(), alreadyGifted: false, closedByAdmin: true }, react(), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: false, error: { code: "gift_closed" } });
    expect(d.entries).toEqual([]);
    expect(d.writes).toEqual([]);
    expect(d.events).toEqual([]);
  });

  test("S22: nobody can react-gift to their own message when they are its only receiver", () => {
    const d = decideGiveByReaction({ ...snap(), alreadyGifted: false, closedByAdmin: false }, react({ target: { author: m("giver"), mentions: [] } }), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: false, error: { code: "not_a_gift" } });
  });

  test("S21: removing a reaction the same day reverses it and returns the allowance; later it changes nothing", () => {
    const gift = existingGift({ id: gid("r1"), source: "reaction", emoji: ":taco:" });
    const net = new Map<MemberId, number>([[m("lind"), 1]]);
    const cmd = { type: "RemoveReaction", key: key("slack:unreact:1"), workspaceId: WS, actor: memberActor("giver"), at: NOON_LIMA, messageRef: "T:C1:1", emoji: ":taco:" } as const;
    const same = decideRemoveReaction({ settings: settings(), gift, net }, cmd, NOON_LIMA);
    expect(same.outcome).toEqual({ ok: true, value: { giftId: "r1", reversed: 1, allowanceRestored: 1 } });
    expect(same.entries).toEqual([
      { kind: "gift_reversal", amount: 1, memberId: "lind", counterpartId: "giver", cause: { type: "gift", giftId: "r1" }, source: "reaction", allowanceDay: TODAY, reason: "reaction_removed" },
    ]);
    expect(same.events).toEqual([{ type: "gift.reversed", giftId: "r1", amount: 1, why: "reaction_removed" }]);
    const nextDay = decideRemoveReaction({ settings: settings(), gift, net }, cmd, at("2026-11-26T15:00:00Z"));
    expect(nextDay.outcome).toEqual({ ok: true, value: { giftId: "r1", reversed: 0, allowanceRestored: 0 } });
    expect(nextDay.entries).toEqual([]);
    expect(nextDay.events).toEqual([]);
  });
});

describe("edit and delete deciders", () => {
  const editCmd = (text: string, emojis: string[], mentions = [mention("ana")]) =>
    ({
      type: "EditMessage",
      key: key("slack:edit:T:C1:1:2"),
      workspaceId: WS,
      actor: memberActor("giver"),
      at: NOON_LIMA,
      messageRef: "T:C1:1",
      message: message({ text, mentions, emojiTokens: emojis }),
    }) as const;

  test("S23: an edit that newly qualifies is processed as a new gift at edit time", () => {
    const d = decideEditMessage({ ...snap(), gift: null, net: new Map() }, editCmd("@Ana :taco:", [":taco:"]), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: true, value: { giftId: "g-new", added: 1, reversed: 0, remainingAllowance: 4 } });
    expect(d.entries).toEqual([
      { kind: "gift", amount: 1, memberId: "ana", counterpartId: "giver", cause: { type: "gift", giftId: "g-new" }, source: "message", allowanceDay: TODAY, reason: "@Ana :taco:" },
    ]);
  });

  test("S23: editing a gift recomputes it and applies top-ups and reversals under the allowance rules", () => {
    const net = new Map<MemberId, number>([[m("ana"), 2], [m("diana"), 2]]);
    // New text: Ana gets 3, Diana is gone.
    const d = decideEditMessage({ ...snap({ allowanceUsed: 4 }), gift: existingGift(), net }, editCmd("@Ana :taco::taco::taco:", [":taco:", ":taco:", ":taco:"]), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: true, value: { giftId: "g1", added: 1, reversed: 2, remainingAllowance: 2 } });
    expect(d.entries).toEqual([
      { kind: "gift", amount: 1, memberId: "ana", counterpartId: "giver", cause: { type: "gift", giftId: "g1" }, source: "message", allowanceDay: TODAY, reason: "@Ana :taco::taco::taco:" },
      { kind: "gift_reversal", amount: 2, memberId: "diana", counterpartId: "giver", cause: { type: "gift", giftId: "g1" }, source: "message", allowanceDay: TODAY, reason: "edit_decrease" },
    ]);
    const header = d.writes[0];
    expect(header?.t === "gift.upsert" && header.gift.text).toBe("@Ana :taco::taco::taco:");
    // A top-up larger than the allowance is refused as a whole.
    const tooMuch = decideEditMessage({ ...snap({ allowanceUsed: 5 }), gift: existingGift(), net }, editCmd("@Ana :taco::taco::taco::taco:", [":taco:", ":taco:", ":taco:", ":taco:"], [mention("ana"), mention("diana")]), NOON_LIMA);
    expect(tooMuch.outcome).toEqual({ ok: false, error: { code: "over_allowance", cost: 4, remaining: 0 } });
    expect(tooMuch.entries).toEqual([]);
  });

  test("S24: deleting a gift message the same day reverses it and returns the allowance; after that day it stands", () => {
    const net = new Map<MemberId, number>([[m("ana"), 2], [m("diana"), 2]]);
    const cmd = { type: "DeleteMessage", key: key("slack:del:T:C1:1"), workspaceId: WS, actor: memberActor("giver"), at: NOON_LIMA, messageRef: "T:C1:1" } as const;
    const same = decideDeleteMessage({ settings: settings(), gift: existingGift(), net }, cmd, NOON_LIMA);
    expect(same.outcome).toEqual({ ok: true, value: { giftId: "g1", reversed: 4, allowanceRestored: 4 } });
    expect(same.entries.map((e) => [e.kind, e.memberId, e.amount, e.allowanceDay, e.reason])).toEqual([
      ["gift_reversal", "ana", 2, TODAY, "message_deleted"],
      ["gift_reversal", "diana", 2, TODAY, "message_deleted"],
    ]);
    const later = decideDeleteMessage({ settings: settings(), gift: existingGift(), net }, cmd, at("2026-11-27T15:00:00Z"));
    expect(later.outcome).toEqual({ ok: true, value: { giftId: "g1", reversed: 0, allowanceRestored: 0 } });
    expect(later.entries).toEqual([]);
    expect(later.writes).toEqual([]);
  });

  test("S24: a same-day deletion closes the gift, so a late edit cannot re-gift it", () => {
    const net = new Map<MemberId, number>([[m("ana"), 2]]);
    const cmd = { type: "DeleteMessage", key: key("slack:del:T:C1:1"), workspaceId: WS, actor: memberActor("giver"), at: NOON_LIMA, messageRef: "T:C1:1" } as const;
    const d = decideDeleteMessage({ settings: settings(), gift: existingGift(), net }, cmd, NOON_LIMA);
    expect(d.writes).toEqual([{ t: "gift.upsert", gift: existingGift({ closedBy: "message_deleted" }) }]);
  });

  test("S38, S23: an edit to a gift an admin reversed is refused and moves nothing, the same day or later", () => {
    const net = new Map<MemberId, number>([[m("ana"), 0]]);
    const gift = existingGift({ closedBy: "admin" });
    for (const now of [NOON_LIMA, at("2026-11-26T15:00:00Z")]) {
      const d = decideEditMessage({ ...snap({ allowanceUsed: 3 }), gift, net }, editCmd("@Ana abuse (typo fixed) :taco::taco::taco:", [":taco:", ":taco:", ":taco:"]), now);
      expect(d.outcome).toEqual({ ok: false, error: { code: "gift_closed" } });
      expect(d.entries).toEqual([]);
      expect(d.writes).toEqual([]);
      expect(d.events).toEqual([]);
    }
    // A smaller amount that fits the allowance is refused too.
    const small = decideEditMessage({ ...snap({ allowanceUsed: 3 }), gift, net }, editCmd("@Ana :taco:", [":taco:"]), NOON_LIMA);
    expect(small.outcome).toEqual({ ok: false, error: { code: "gift_closed" } });
  });

  test("S24, S23: an edit to a deleted gift message is refused and moves nothing", () => {
    const d = decideEditMessage({ ...snap(), gift: existingGift({ closedBy: "message_deleted" }), net: new Map([[m("ana"), 0]]) }, editCmd("@Ana :taco::taco:", [":taco:", ":taco:"]), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: false, error: { code: "gift_closed" } });
    expect(d.entries).toEqual([]);
  });
});
