// i18n S3: members' Slack locales are captured where profiles are already fetched (users.info on first
// sighting, users.list sweep, user_change), and the server resolves the language per member (member
// choice → Slack locale → workspace default → en) and per workspace for channel posts.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Instant, MemberId, WorkspaceId } from "@propi/app";
import { createSecretCipher } from "@propi/db";
import { createLocales } from "../src/locale.ts";
import { createSlackLookup, provisionedMemberId, syncProfiles } from "../src/lookup.ts";
import { createRuntime, type Runtime } from "../src/runtime.ts";
import { webSlackApi } from "../src/slack-api.ts";
import { fakeSlack, gatewayOf, installTeam } from "./fakes.ts";
import { createTestDatabase, hasDatabase } from "./pg.ts";

describe("i18n S3 the Slack Web API asks for and reads the user's locale", () => {
  test("users.info and users.list send include_locale and map `locale` to slackLocale", async () => {
    const calls: { method: string; args: unknown }[] = [];
    const client = {
      users: {
        info: async (args: unknown) => (calls.push({ method: "users.info", args }), { user: { id: "U1", name: "ana", locale: "es-LA", profile: { display_name: "Ana" } } }),
        list: async (args: unknown) => (
          calls.push({ method: "users.list", args }),
          { members: [{ id: "U1", name: "ana", locale: "es-LA" }, { id: "U2", name: "bo" }], response_metadata: { next_cursor: "" } }
        ),
      },
    };
    const api = webSlackApi(client as never);
    expect(await api.userInfo("U1")).toEqual({ id: "U1", isBot: false, deleted: false, displayName: "Ana", avatarUrl: null, slackLocale: "es-LA" });
    const list = await api.usersList();
    expect(list.map((u) => [u.id, u.slackLocale])).toEqual([
      ["U1", "es-LA"],
      ["U2", undefined],
    ]);
    expect(calls).toEqual([
      { method: "users.info", args: { user: "U1", include_locale: true } },
      { method: "users.list", args: { limit: 200, include_locale: true } },
    ]);
  });
});

const TEAM = "T0LOCALE01";
const T0 = Date.UTC(2026, 10, 25, 15, 0, 0);
let db: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
let rt: Runtime;
let ws: WorkspaceId;
const slack = fakeSlack({
  teamId: TEAM,
  profiles: {
    U0ANA00001: { displayName: "ana", avatarUrl: null, slackLocale: "es-LA" },
    U0BOSS0001: { displayName: "Boss", avatarUrl: null, slackLocale: "en-US" },
    U0NOLOC001: { displayName: "Neo", avatarUrl: null },
  },
});
const member = (user: string) => provisionedMemberId(ws, TEAM, user);

beforeAll(async () => {
  if (!hasDatabase) return;
  db = await createTestDatabase();
  let n = 0;
  rt = createRuntime(db.client, { cipher: createSecretCipher("00".repeat(32)), clock: { now: () => T0 as Instant }, ids: { next: (kind) => `${kind}-${++n}` } });
  ws = await installTeam(rt, { team: TEAM, installer: "U0BOSS0001", now: T0 });
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

describe.skipIf(!hasDatabase)("i18n S3 Slack locale capture and server resolution on Postgres", () => {
  test("the first sighting stores the member's Slack locale; the server resolves their language from it", async () => {
    const lookup = createSlackLookup(rt, gatewayOf(rt, { [TEAM]: slack.api }));
    await lookup.mention(ws, TEAM, "U0ANA00001");
    expect(await rt.ports.directory.member(ws, member("U0ANA00001"))).toMatchObject({ displayName: "ana", slackLocale: "es-LA" });
    const locales = createLocales(rt.ports.directory);
    expect(await locales.member(ws, member("U0ANA00001"))).toBe("es");
    expect(await locales.workspace(ws)).toBe("en");
  });

  test("the users.list sweep fills the installer's Slack locale", async () => {
    const installer = (await rt.ports.directory.members(ws)).find((r) => r.role === "admin")!;
    expect(installer.slackLocale).toBeUndefined();
    await syncProfiles(rt, slack.api, ws, TEAM);
    expect(await rt.ports.directory.member(ws, installer.id)).toMatchObject({ displayName: "Boss", slackLocale: "en-US" });
  });

  test("member choice beats Slack locale, which beats the workspace default; channel posts use the workspace default", async () => {
    const locales = createLocales(rt.ports.directory);
    const lookup = createSlackLookup(rt, gatewayOf(rt, { [TEAM]: slack.api }));
    await lookup.mention(ws, TEAM, "U0NOLOC001");
    await rt.admin.updateSettings(ws, (s) => ({ ...s, language: "es" }));
    expect(await locales.member(ws, member("U0NOLOC001"))).toBe("es");
    const boss = (await rt.ports.directory.members(ws)).find((r) => r.role === "admin")!.id as MemberId;
    expect(await locales.member(ws, boss)).toBe("en");
    await rt.admin.setMemberLanguage(ws, member("U0ANA00001"), "en");
    expect(await locales.member(ws, member("U0ANA00001"))).toBe("en");
    expect(await locales.workspace(ws)).toBe("es");
  });
});
