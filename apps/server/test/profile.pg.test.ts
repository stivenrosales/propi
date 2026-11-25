// S6: members carry their Slack display name and avatar. Filled on first sighting, kept fresh by
// user_change / team_join, and backfilled for members that existed before.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Instant, MemberId, WorkspaceId } from "@propi/app";
import { createSecretCipher } from "@propi/db";
import type { SlackEnvelope } from "@propi/slack";
import { handleEvent, type InboundDeps } from "../src/inbound.ts";
import { createSlackLookup, provisionedMemberId, syncProfiles } from "../src/lookup.ts";
import { createRuntime, type Runtime } from "../src/runtime.ts";
import { profileOf } from "../src/slack-api.ts";
import { fakeSlack, gatewayOf, installTeam } from "./fakes.ts";
import { createTestDatabase, hasDatabase } from "./pg.ts";

const TEAM = "T0PROPI001";
const T0 = Date.UTC(2026, 10, 25, 15, 0, 0);

let db: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
let rt: Runtime;
let ws: WorkspaceId;
const slack = fakeSlack({
  bots: ["U0BOTUSER1"],
  profiles: {
    U0ANA00001: { displayName: "ana", avatarUrl: "https://img/ana_192.png" },
    U0BOSS0001: { displayName: "Boss", avatarUrl: "https://img/boss_192.png" },
    U0STRANGER: { displayName: "Stranger", avatarUrl: null },
  },
});
let d: InboundDeps;

const member = (user: string) => provisionedMemberId(ws, TEAM, user);
const userEvent = (type: "user_change" | "team_join", user: Record<string, unknown>): SlackEnvelope =>
  ({ type: "event_callback", team_id: TEAM, event_id: `Ev-${type}-${String(user["id"])}`, event_time: T0 / 1000, event: { type, user } }) as unknown as SlackEnvelope;

beforeAll(async () => {
  if (!hasDatabase) return;
  db = await createTestDatabase();
  let n = 0;
  rt = createRuntime(db.client, { cipher: createSecretCipher("00".repeat(32)), clock: { now: () => T0 as Instant }, ids: { next: (kind) => `${kind}-${++n}` } });
  const gateway = gatewayOf(rt, { [TEAM]: slack.api });
  d = { rt, lookup: createSlackLookup(rt, gateway), slack: gateway, appUrl: null, log: () => undefined };
  ws = await installTeam(rt, { team: TEAM, installer: "U0BOSS0001", now: T0 });
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

describe("profileOf (S6)", () => {
  test("prefers display_name, then real_name, then name; avatar image_192, then image_72", () => {
    expect(profileOf({ name: "ana.t", real_name: "Ana Torres", profile: { display_name: "Ana", image_192: "a192", image_72: "a72" } })).toEqual({ displayName: "Ana", avatarUrl: "a192" });
    expect(profileOf({ name: "ana.t", profile: { display_name: " ", real_name: "Ana Torres", image_72: "a72" } })).toEqual({ displayName: "Ana Torres", avatarUrl: "a72" });
    expect(profileOf({ name: "ana.t", profile: {} })).toEqual({ displayName: "ana.t", avatarUrl: null });
    expect(profileOf({})).toEqual({ displayName: null, avatarUrl: null });
  });
});

describe.skipIf(!hasDatabase)("member profiles on Postgres (S6)", () => {
  test("the first sighting of a Slack user stores their display name and avatar", async () => {
    const mention = await d.lookup.mention(ws, TEAM, "U0ANA00001");
    expect(mention).toEqual({ kind: "member", memberId: member("U0ANA00001") });
    expect(await rt.ports.directory.member(ws, member("U0ANA00001"))).toMatchObject({ displayName: "ana", avatarUrl: "https://img/ana_192.png" });
  });

  test("user_change updates a linked member's profile", async () => {
    const out = await handleEvent(d, userEvent("user_change", { id: "U0ANA00001", name: "ana.t", deleted: false, is_bot: false, profile: { display_name: "Ana T.", image_192: "https://img/ana2_192.png" } }));
    expect(out).toMatchObject({ handled: "lifecycle", type: "user_change" });
    expect(await rt.ports.directory.member(ws, member("U0ANA00001"))).toMatchObject({ displayName: "Ana T.", avatarUrl: "https://img/ana2_192.png" });
  });

  test("team_join and user_change never create members: people join Propi on first sighting; bots are ignored", async () => {
    await handleEvent(d, userEvent("team_join", { id: "U0NEW00001", name: "newbie", deleted: false, is_bot: false, profile: { real_name: "New Person", image_72: "https://img/new_72.png" } }));
    expect(await rt.ports.directory.member(ws, member("U0NEW00001"))).toBeNull();
    await handleEvent(d, userEvent("user_change", { id: "U0GUEST001", name: "guest", deleted: false, is_bot: false, profile: { display_name: "Guest" } }));
    expect(await rt.ports.directory.member(ws, member("U0GUEST001"))).toBeNull();
    await handleEvent(d, userEvent("team_join", { id: "U0BOTUSER1", name: "bot", is_bot: true, profile: { display_name: "Bot" } }));
    expect(await rt.ports.directory.member(ws, member("U0BOTUSER1"))).toBeNull();
  });

  test("syncProfiles backfills linked members from users.list and leaves unknown users alone", async () => {
    const installer = (await rt.ports.directory.members(ws)).find((r) => r.role === "admin")!;
    expect(installer.displayName).toBeUndefined();
    const r = await syncProfiles(rt, slack.api, ws, TEAM);
    expect(r.updated).toBeGreaterThanOrEqual(1);
    expect(await rt.ports.directory.member(ws, installer.id as MemberId)).toMatchObject({ displayName: "Boss", avatarUrl: "https://img/boss_192.png" });
    expect(await rt.ports.directory.member(ws, member("U0STRANGER"))).toBeNull();
  });
});
