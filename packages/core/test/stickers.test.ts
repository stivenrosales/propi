import { describe, expect, test } from "vitest";
import type { PosInt } from "../src/index.ts";
import {
  STICKERS_OFF,
  STICKER_PRESET,
  decideConfigureStickers,
  decideDefineSticker,
  decideGiveSticker,
  decideGrantStickerUses,
  type GiveSticker,
  type GiveStickerSnapshot,
  type StickerDef,
} from "../src/stickers/index.ts";
import { NOON_LIMA, WS, gid, key, m, memberActor, mention, record, settings } from "./fixtures.ts";

const p = (n: number) => n as PosInt;
const admin = memberActor("boss", "admin");
const truck: StickerDef = { id: "truck", name: "Truck", image: null, receivers: p(5), unitsPerReceiver: p(2), monthlyQuota: p(1), active: true };
const confetti: StickerDef = { id: "confetti", name: "Confetti", image: null, receivers: "channel", unitsPerReceiver: p(1), monthlyQuota: p(1), active: true };
const active = new Set(["giver", "ana", "bob", "cy"].map(m));

const snap = (over: Partial<GiveStickerSnapshot> = {}): GiveStickerSnapshot => ({
  settings: settings(),
  config: { enabled: true },
  sticker: truck,
  giverRecord: record("giver"),
  activeMembers: active,
  used: 0,
  granted: 0,
  newGiftId: gid("g-new"),
  ...over,
});
const give = (over: Partial<GiveSticker> = {}): GiveSticker => ({
  type: "GiveSticker",
  key: key("slack:sticker:T:C1:1"),
  workspaceId: WS,
  actor: memberActor("giver"),
  at: NOON_LIMA,
  messageRef: "T:C1:1",
  stickerId: "truck",
  channel: { id: "C1", kind: "public" },
  mentions: [mention("ana"), mention("bob")],
  channelMembers: [],
  ...over,
});
const err = (d: { outcome: { ok: boolean } }) => (d.outcome as { error?: unknown }).error;

describe("stickers", () => {
  test("S73: the module is OFF by default; while off, sticker gifts are refused", () => {
    expect(STICKERS_OFF).toEqual({ enabled: false });
    expect(err(decideGiveSticker(snap({ config: STICKERS_OFF }), give(), NOON_LIMA))).toEqual({ code: "module_disabled" });
    const on = decideConfigureStickers({ type: "ConfigureStickers", key: key("api:s"), workspaceId: WS, actor: admin, at: NOON_LIMA, enabled: true }, NOON_LIMA);
    expect(on.writes).toEqual([{ t: "sticker.config", config: { enabled: true } }]);
  });

  test("S73: an admin defines stickers (name, image, receivers or whole channel, units per receiver); Pearson's set can be preloaded", () => {
    const cmd = { type: "DefineSticker" as const, key: key("api:d"), workspaceId: WS, actor: admin, at: NOON_LIMA, sticker: { id: "rain", name: "Rain", image: "rain.png", receivers: p(10), unitsPerReceiver: p(1) } };
    const d = decideDefineSticker(cmd, NOON_LIMA);
    expect(d.writes).toEqual([{ t: "sticker.upsert", sticker: { ...cmd.sticker, monthlyQuota: 1, active: true } }]);
    expect(err(decideDefineSticker({ ...cmd, actor: memberActor("ana") }, NOON_LIMA))).toEqual({ code: "forbidden", need: "admin" });
    expect(err(decideDefineSticker({ ...cmd, sticker: { ...cmd.sticker, unitsPerReceiver: p(0) } }, NOON_LIMA))).toEqual({ code: "invalid_field", field: "unitsPerReceiver" });
    expect(STICKER_PRESET.map((s) => [s.name, s.receivers, s.unitsPerReceiver])).toEqual([
      ["Confetti", "channel", 1],
      ["High Five", 3, 1],
      ["Piñata", 6, 1],
      ["Trophy", 1, 5],
      ["Truck", 5, 2],
      ["Rain", 10, 1],
      ["Rockstars", 5, 1],
      ["Tacocat", 1, 2],
    ]);
  });

  test("S74: a sticker gift skips the allowance (allowanceDay null) and counts toward received as gift entries", () => {
    const d = decideGiveSticker(snap({ settings: settings({ defaultDailyAllowance: p(1) }) }), give(), NOON_LIMA);
    expect(d.outcome).toEqual({ ok: true, value: { giftId: "g-new", receivers: ["ana", "bob"], perReceiver: 2, totalCost: 4, remainingAllowance: null, usesLeft: 0 } });
    expect(d.entries.map((e) => [e.kind, e.memberId, e.counterpartId, e.amount, e.source, e.allowanceDay])).toEqual([
      ["gift", "ana", "giver", 2, "sticker", null],
      ["gift", "bob", "giver", 2, "sticker", null],
    ]);
    expect(d.writes).toContainEqual({ t: "sticker.used", use: { giftId: "g-new", stickerId: "truck", giver: "giver", month: "2026-11" } });
    expect(d.writes.find((w) => w.t === "gift.upsert")).toMatchObject({ gift: { source: "sticker", allowanceDay: null, giver: "giver" } });
    expect(d.events).toEqual([{ type: "gift.given", giftId: "g-new", giver: "giver", receivers: ["ana", "bob"], perReceiver: 2, totalCost: 4, remainingAllowance: null, source: "sticker" }]);
  });

  test("S73: receivers are capped by the sticker; a whole-channel sticker goes to the channel's active members except the giver", () => {
    const many = [mention("ana"), mention("bob"), mention("cy")];
    expect(err(decideGiveSticker(snap({ sticker: { ...truck, receivers: p(2) } }), give({ mentions: many }), NOON_LIMA))).toEqual({ code: "too_many_receivers", max: 2 });
    const all = decideGiveSticker(snap({ sticker: confetti }), give({ stickerId: "confetti", mentions: [], channelMembers: [m("giver"), m("ana"), m("cy"), m("gone")] }), NOON_LIMA);
    expect(all.outcome.ok && all.outcome.value.receivers).toEqual(["ana", "cy"]);
    expect(err(decideGiveSticker(snap(), give({ mentions: [mention("giver")] }), NOON_LIMA))).toEqual({ code: "not_a_gift" });
  });

  test("S75: a plain monthly quota per member per sticker (default 1)", () => {
    expect(err(decideGiveSticker(snap({ used: 1 }), give(), NOON_LIMA))).toEqual({ code: "quota_exhausted", used: 1, available: 1 });
    expect(decideGiveSticker(snap({ used: 1, sticker: { ...truck, monthlyQuota: p(2) } }), give(), NOON_LIMA).outcome.ok).toBe(true);
  });

  test("S76: an admin grants extra sticker uses to a member for the current month", () => {
    const g = decideGrantStickerUses(
      { settings: settings(), sticker: truck, member: record("giver") },
      { type: "GrantStickerUses", key: key("api:g"), workspaceId: WS, actor: admin, at: NOON_LIMA, memberId: m("giver"), stickerId: "truck", uses: p(2) },
      NOON_LIMA,
    );
    expect(g.writes).toEqual([{ t: "sticker.grant", grant: { memberId: "giver", stickerId: "truck", month: "2026-11", uses: 2 } }]);
    expect(decideGiveSticker(snap({ used: 2, granted: 2 }), give(), NOON_LIMA).outcome).toMatchObject({ ok: true, value: { usesLeft: 0 } });
    expect(err(decideGrantStickerUses({ settings: settings(), sticker: truck, member: record("giver") }, { type: "GrantStickerUses", key: key("api:g"), workspaceId: WS, actor: memberActor("ana"), at: NOON_LIMA, memberId: m("giver"), stickerId: "truck", uses: p(2) }, NOON_LIMA))).toEqual({
      code: "forbidden",
      need: "admin",
    });
  });

  test("S73: unknown or inactive stickers and inactive givers are refused", () => {
    expect(err(decideGiveSticker(snap({ sticker: null }), give(), NOON_LIMA))).toEqual({ code: "not_found", what: "sticker" });
    expect(err(decideGiveSticker(snap({ sticker: { ...truck, active: false } }), give(), NOON_LIMA))).toEqual({ code: "not_found", what: "sticker" });
    expect(err(decideGiveSticker(snap({ giverRecord: record("giver", { active: false }) }), give(), NOON_LIMA))).toEqual({ code: "inactive_member" });
    expect(err(decideGiveSticker(snap(), give({ channel: { id: "D1", kind: "dm" } }), NOON_LIMA))).toEqual({ code: "channel_not_allowed" });
  });
});


