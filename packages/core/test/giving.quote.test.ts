import { describe, expect, test } from "vitest";
import { quoteGift, type PosInt, type Value, type ValueId } from "../src/index.ts";
import { m, mention, message, settings } from "./fixtures.ts";

const active = new Set(["lind", "ana", "diana", "giver", "g1", "g2"].map(m));
const ctx = (over: Partial<Parameters<typeof quoteGift>[2]> = {}) => ({
  settings: settings(),
  values: [] as readonly Value[],
  activeMembers: active,
  ...over,
});

describe("quoteGift", () => {
  test("S9: a gift needs >= 1 receiver and >= 1 recognized emoji; the amount is the sum of emoji values", () => {
    const msg = message({ text: "@Lind gracias por la sesión :taco: :taco: :taco:", mentions: [mention("lind")], emojiTokens: [":taco:", ":taco:", ":taco:"] });
    expect(quoteGift(msg, m("giver"), ctx())).toEqual({
      ok: true,
      quote: { receivers: [m("lind")], perReceiver: 3, totalCost: 3, valueIds: [] },
    });
    expect(quoteGift(message({ mentions: [mention("lind")], emojiTokens: [":smile:"] }), m("giver"), ctx())).toEqual({
      ok: false,
      error: { code: "not_a_gift" },
    });
    expect(quoteGift(message({ emojiTokens: [":taco:"] }), m("giver"), ctx())).toEqual({ ok: false, error: { code: "not_a_gift" } });
    const fire = settings({ currency: { ...settings().currency, extraEmojis: new Map([[":fire:", 3 as PosInt]]) } });
    const q = quoteGift(message({ mentions: [mention("lind")], emojiTokens: [":fire:", ":taco:"] }), m("giver"), ctx({ settings: fire }));
    expect(q.ok && q.quote.perReceiver).toBe(4);
  });

  test("S10: each mentioned receiver gets the full amount and the cost is amount x receivers", () => {
    const msg = message({ mentions: [mention("ana"), mention("diana")], emojiTokens: [":taco:", ":taco:"] });
    expect(quoteGift(msg, m("giver"), ctx())).toEqual({
      ok: true,
      quote: { receivers: [m("ana"), m("diana")], perReceiver: 2, totalCost: 4, valueIds: [] },
    });
    const dup = message({ mentions: [mention("ana"), mention("ana")], emojiTokens: [":taco:"] });
    const q = quoteGift(dup, m("giver"), ctx());
    expect(q.ok && q.quote.totalCost).toBe(1);
  });

  test("S11: the giver is excluded; a message whose only receiver is the giver is not a gift", () => {
    const withSelf = message({ mentions: [mention("giver"), mention("ana")], emojiTokens: [":taco:"] });
    const q = quoteGift(withSelf, m("giver"), ctx());
    expect(q.ok && q.quote.receivers).toEqual([m("ana")]);
    expect(quoteGift(message({ mentions: [mention("giver")], emojiTokens: [":taco:"] }), m("giver"), ctx())).toEqual({
      ok: false,
      error: { code: "not_a_gift" },
    });
  });

  test("S12: group mentions expand to active members minus the giver when ON, and are ignored when OFF", () => {
    const msg = message({
      mentions: [{ kind: "group", groupId: "S1", memberIds: [m("g1"), m("giver"), m("g2"), m("gone")] }],
      emojiTokens: [":taco:"],
    });
    expect(quoteGift(msg, m("giver"), ctx())).toEqual({
      ok: true,
      quote: { receivers: [m("g1"), m("g2")], perReceiver: 1, totalCost: 2, valueIds: [] },
    });
    expect(quoteGift(msg, m("giver"), ctx({ settings: settings({ groupMentionsEnabled: false }) }))).toEqual({
      ok: false,
      error: { code: "not_a_gift" },
    });
  });

  test("S7: deactivated members are dropped from receivers", () => {
    const msg = message({ mentions: [mention("gone"), mention("ana")], emojiTokens: [":taco:"] });
    const q = quoteGift(msg, m("giver"), ctx());
    expect(q.ok && q.quote.receivers).toEqual([m("ana")]);
  });

  test("S8: bot mentions never receive", () => {
    const msg = message({ mentions: [{ kind: "bot" }], emojiTokens: [":taco:"] });
    expect(quoteGift(msg, m("giver"), ctx())).toEqual({ ok: false, error: { code: "not_a_gift" } });
  });

  test("S15: hashtags matching workspace values are attached as value tags", () => {
    const values: Value[] = [
      { id: "v-own" as ValueId, name: "Ownership", hashtag: "#ownership", emoji: null },
      { id: "v-care" as ValueId, name: "Care", hashtag: "#care", emoji: null },
    ];
    const msg = message({ mentions: [mention("ana")], emojiTokens: [":taco:"], hashtags: ["#Ownership", "#random"] });
    const q = quoteGift(msg, m("giver"), ctx({ values }));
    expect(q.ok && q.quote.valueIds).toEqual(["v-own"]);
  });

  test("S16: gifts in DMs are refused; private channels only when the workspace allows them", () => {
    const base = { mentions: [mention("ana")], emojiTokens: [":taco:"] };
    expect(quoteGift(message({ ...base, channel: { id: "D1", kind: "dm" } }), m("giver"), ctx())).toEqual({
      ok: false,
      error: { code: "channel_not_allowed" },
    });
    const priv = message({ ...base, channel: { id: "G1", kind: "private" } });
    expect(quoteGift(priv, m("giver"), ctx({ settings: settings({ privateChannelsAllowed: false }) }))).toEqual({
      ok: false,
      error: { code: "channel_not_allowed" },
    });
    expect(quoteGift(priv, m("giver"), ctx({ settings: settings({ privateChannelsAllowed: true }) })).ok).toBe(true);
  });
});
