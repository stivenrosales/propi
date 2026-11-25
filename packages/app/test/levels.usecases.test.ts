import { describe, expect, test } from "vitest";
import type { GiftId, PosInt } from "@propi/core";
import { memberLevel } from "../src/levels/index.ts";
import { engagementSetup } from "./engagement.setup.ts";
import { T0, WS, admin, giveCmd, key, m, memberActor, mention, msg } from "./setup.ts";

const table = [
  { level: 1, title: "Sprout", min: 0 },
  { level: 2, title: "Helper", min: 3 },
  { level: 3, title: "Champion", min: 6 },
];
const avatars = [
  { id: "cat", name: "Cat", image: null, minLevel: 1 },
  { id: "dragon", name: "Dragon", image: null, minLevel: 2 },
];
const configure = { type: "ConfigureLevels", key: key("api:levels"), workspaceId: WS, actor: admin, at: T0, table, avatars } as const;
const choose = (avatarId: string, k: string) => ({ type: "ChooseAvatar", key: key(k), workspaceId: WS, actor: memberActor("ana"), at: T0, avatarId }) as const;

describe("levels through the app", () => {
  test("S77, S78: the level is folded from received + given on every read; bonuses do not count, reversals do", async () => {
    const { run, app, eng } = engagementSetup();
    await run(configure);
    await app.execute(giveCmd("giver", msg("@Ana :taco::taco::taco:", [mention("ana")], 3)));
    expect(await memberLevel(eng.deps, WS, m("ana"))).toMatchObject({ level: 2, title: "Helper", points: 3 });
    expect(await memberLevel(eng.deps, WS, m("giver"))).toMatchObject({ level: 2, points: 3 });
    await app.execute({ type: "GrantBonus", key: key("api:b"), workspaceId: WS, actor: admin, at: T0, memberIds: [m("ana")], amount: 50 as PosInt, reason: "launch" });
    expect(await memberLevel(eng.deps, WS, m("ana"))).toMatchObject({ level: 2, points: 3 });
    await app.execute({ type: "ReverseGift", key: key("api:rev"), workspaceId: WS, actor: admin, at: T0, giftId: "gift-1" as GiftId, reason: "mistake" });
    expect(await memberLevel(eng.deps, WS, m("ana"))).toMatchObject({ level: 1, points: 0 });
  });

  test("S79: avatars unlock by level", async () => {
    const { run, app, eng } = engagementSetup();
    await run(configure);
    expect(await run(choose("dragon", "web:av:1"))).toEqual({ ok: false, replayed: false, error: { code: "avatar_locked", minLevel: 2, level: 1 } });
    await app.execute(giveCmd("giver", msg("@Ana :taco::taco::taco:", [mention("ana")], 3)));
    expect(await run(choose("dragon", "web:av:2"))).toEqual({ ok: true, replayed: false, value: { avatarId: "dragon", level: 2 } });
    expect(await memberLevel(eng.deps, WS, m("ana"))).toMatchObject({ avatarId: "dragon", unlockedAvatars: avatars });
  });
});
