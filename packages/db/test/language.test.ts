// i18n S3, S4: the workspace default language in settings JSON (back-compatible with settings saved
// before i18n) and each member's own language and Slack locale, read back through the directory.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { memberLocale, workspaceLocale } from "@propi/app";
import { defaultSettings, type MemberId, type WorkspaceId } from "@propi/core";
import { createDbAdmin, createDbPorts, settingsFromJson, settingsToJson, type PrismaClient } from "../src/index.ts";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./pg.ts";

/** Settings JSON as stored before i18n existed: no `language`. */
const legacyJson = {
  timezone: "America/Lima",
  currency: { primaryEmoji: ":taco:", singular: "taco", plural: "tacos", extraEmojis: [[":fire:", 3]] },
  defaultDailyAllowance: 5,
  adminDailyAllowance: 5,
  reactionsEnabled: true,
  groupMentionsEnabled: true,
  privateChannelsAllowed: false,
  storeMessageText: true,
  botsMayGive: false,
};

describe("i18n S3 workspace language in settings JSON", () => {
  test("settings saved before i18n read back unchanged, with no language (resolves to en)", () => {
    const s = settingsFromJson(legacyJson);
    expect(s.language).toBeUndefined();
    expect(s.timezone).toBe("America/Lima");
    expect(s.currency.extraEmojis.get(":fire:")).toBe(3);
    expect(settingsToJson(s)).toEqual(legacyJson);
  });

  test("a stored language round-trips; an unknown one is dropped", () => {
    expect(settingsFromJson(settingsToJson(defaultSettings({ language: "es" }))).language).toBe("es");
    expect(settingsFromJson({ ...legacyJson, language: "fr" }).language).toBeUndefined();
  });
});

let db: TestDatabase | undefined;
let pg: PrismaClient | undefined;
beforeAll(async () => {
  if (hasDatabase) {
    db = await createTestDatabase();
    pg = db.client();
  }
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

const WS = "ws-language" as WorkspaceId;
const ana = "ana-id" as MemberId;

describe.skipIf(!hasDatabase)("i18n S3, S4 language storage on Postgres", () => {
  test("a workspace stored without language resolves to en; updateSettings sets it and keeps the rest", async () => {
    const admin = createDbAdmin(pg!);
    const { directory } = createDbPorts(pg!);
    await pg!.$executeRaw`INSERT INTO workspace (id, settings) VALUES (${WS}, ${JSON.stringify(legacyJson)}::jsonb)`;
    expect(await workspaceLocale(directory, WS)).toBe("en");
    await admin.updateSettings(WS, (s) => ({ ...s, language: "es" }));
    const s = await directory.settings(WS);
    expect(s).toMatchObject({ language: "es", timezone: "America/Lima", defaultDailyAllowance: 5 });
    expect(await workspaceLocale(directory, WS)).toBe("es");
  });

  test("existing settings updates still work and keep the language", async () => {
    const admin = createDbAdmin(pg!);
    const { directory } = createDbPorts(pg!);
    await admin.updateSettings(WS, (s) => ({ ...s, timezone: "America/Bogota", reactionsEnabled: false }));
    expect(await directory.settings(WS)).toMatchObject({ timezone: "America/Bogota", reactionsEnabled: false, language: "es" });
  });

  test("a member has no language or Slack locale until set; the profile write stores the Slack locale", async () => {
    const admin = createDbAdmin(pg!);
    const { directory } = createDbPorts(pg!);
    await admin.addMember(WS, { id: ana, role: "member", active: true, dailyLimitOverride: null });
    expect(await directory.member(WS, ana)).toEqual({ id: ana, role: "member", active: true, dailyLimitOverride: null });
    await admin.setMemberProfile(WS, ana, { displayName: "Ana", avatarUrl: null, slackLocale: "en-US" });
    expect(await directory.member(WS, ana)).toMatchObject({ displayName: "Ana", slackLocale: "en-US" });
    // A profile write without a locale (the web sign-in) keeps the stored one.
    await admin.setMemberProfile(WS, ana, { displayName: "Ana T.", avatarUrl: null });
    expect(await directory.member(WS, ana)).toMatchObject({ displayName: "Ana T.", slackLocale: "en-US" });
    // Slack locale en-US beats the workspace default es.
    expect(await memberLocale(directory, WS, ana)).toBe("en");
  });

  test("setMemberLanguage stores the member's choice; auto clears it; addMember keeps it", async () => {
    const admin = createDbAdmin(pg!);
    const { directory } = createDbPorts(pg!);
    await admin.setMemberLanguage(WS, ana, "es");
    expect(await directory.member(WS, ana)).toMatchObject({ language: "es" });
    expect(await memberLocale(directory, WS, ana)).toBe("es");
    await admin.addMember(WS, { id: ana, role: "approver", active: true, dailyLimitOverride: null });
    expect(await directory.member(WS, ana)).toMatchObject({ role: "approver", language: "es", slackLocale: "en-US" });
    await admin.setMemberLanguage(WS, ana, "auto");
    expect((await directory.member(WS, ana))?.language).toBeUndefined();
    expect(await memberLocale(directory, WS, ana)).toBe("en");
    expect((await directory.members(WS)).find((r) => r.id === ana)).toMatchObject({ slackLocale: "en-US" });
  });
});
