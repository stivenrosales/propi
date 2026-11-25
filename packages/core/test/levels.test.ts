import { describe, expect, test } from "vitest";
import { replay, type NewEntry, type PosInt } from "../src/index.ts";
import {
  DEFAULT_LEVELS,
  decideChooseAvatar,
  decideConfigureLevels,
  levelFor,
  levelOf,
  unlockedAvatars,
  validateLevelTable,
  type Avatar,
} from "../src/levels/index.ts";
import { NOON_LIMA, WS, gid, key, m, memberActor } from "./fixtures.ts";

const table = [
  { level: 1, title: "Sprout", min: 0 },
  { level: 2, title: "Helper", min: 10 },
  { level: 3, title: "Champion", min: 50 },
];
const avatars: Avatar[] = [
  { id: "cat", name: "Cat", image: null, minLevel: 1 },
  { id: "dragon", name: "Dragon", image: null, minLevel: 3 },
];
const gift = (giver: string, receiver: string, amount: number): NewEntry => ({
  kind: "gift",
  amount: amount as PosInt,
  memberId: m(receiver),
  counterpartId: m(giver),
  cause: { type: "gift", giftId: gid("g") },
  source: "message",
  allowanceDay: null,
  reason: null,
});
const bonus = (to: string, amount: number): NewEntry => ({ kind: "bonus", amount: amount as PosInt, memberId: m(to), counterpartId: null, cause: { type: "admin" }, source: null, allowanceDay: null, reason: "x" });

describe("levels and avatars", () => {
  test("S77: a level (number and title) derives from received plus given through a published threshold table", () => {
    expect(DEFAULT_LEVELS[0]).toEqual({ level: 1, title: expect.any(String), min: 0 });
    expect(validateLevelTable(DEFAULT_LEVELS)).toBeNull();
    expect(levelFor(9, table)).toEqual(table[0]);
    expect(levelFor(10, table)).toEqual(table[1]);
    expect(levelOf({ received: 30, given: 25, redeemable: 0 }, table)).toEqual({ level: 3, title: "Champion", points: 55, next: null });
    expect(levelOf({ received: 4, given: 0, redeemable: 999 }, table)).toEqual({ level: 1, title: "Sprout", points: 4, next: { level: 2, title: "Helper", min: 10 } });
  });

  test("S77: a table must start at 0 and strictly increase", () => {
    expect(validateLevelTable([])).toEqual({ code: "invalid_field", field: "levels" });
    expect(validateLevelTable([{ level: 1, title: "A", min: 5 }])).toEqual({ code: "invalid_field", field: "levels[0].min" });
    expect(validateLevelTable([{ level: 1, title: "A", min: 0 }, { level: 2, title: "B", min: 0 }])).toEqual({ code: "invalid_field", field: "levels[1].min" });
  });

  test("S78: levels are recomputed from the ledger; bonuses and awards do not raise them", () => {
    const entries = [gift("ana", "bob", 6), gift("bob", "ana", 5), bonus("bob", 100)];
    const bob = replay(entries).get(m("bob"))!;
    expect(levelOf(bob, table)).toMatchObject({ level: 2, points: 11 });
    const withReversal = [...entries, { ...gift("ana", "bob", 6), kind: "gift_reversal" as const }];
    expect(levelOf(replay(withReversal).get(m("bob"))!, table)).toMatchObject({ level: 1, points: 5 });
  });

  test("S79: avatars unlock by level; choosing a locked one is refused", () => {
    expect(unlockedAvatars(2, avatars).map((a) => a.id)).toEqual(["cat"]);
    const choose = (avatarId: string, received: number) =>
      decideChooseAvatar(
        { table, avatars, balances: { received, given: 0, redeemable: 0 } },
        { type: "ChooseAvatar", key: key(`web:avatar:${avatarId}`), workspaceId: WS, actor: memberActor("ana"), at: NOON_LIMA, avatarId },
        NOON_LIMA,
      );
    expect(choose("dragon", 10).outcome).toEqual({ ok: false, error: { code: "avatar_locked", minLevel: 3, level: 2 } });
    const ok = choose("dragon", 50);
    expect(ok.outcome).toEqual({ ok: true, value: { avatarId: "dragon", level: 3 } });
    expect(ok.writes).toEqual([{ t: "avatar.choose", memberId: "ana", avatarId: "dragon" }]);
    expect(choose("unicorn", 50).outcome).toEqual({ ok: false, error: { code: "not_found", what: "avatar" } });
  });

  test("S77, S79: an admin publishes the threshold table and the avatar set", () => {
    const cmd = { type: "ConfigureLevels" as const, key: key("api:lv"), workspaceId: WS, actor: memberActor("boss", "admin"), at: NOON_LIMA, table, avatars };
    expect(decideConfigureLevels(cmd, NOON_LIMA).writes).toEqual([{ t: "levels.config", config: { table, avatars } }]);
    expect(decideConfigureLevels({ ...cmd, table: [] }, NOON_LIMA).outcome).toEqual({ ok: false, error: { code: "invalid_field", field: "levels" } });
    expect(decideConfigureLevels({ ...cmd, actor: memberActor("ana") }, NOON_LIMA).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
  });
});


