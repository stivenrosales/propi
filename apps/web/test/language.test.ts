// i18n S3, S4: which language a web request renders in, the member's language choice from Profile and
// the workspace default from admin Settings, through the framework-free helpers the actions call.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { defaultSettings, type Directory, type LanguageChoice, type MemberId, type MemberRecord, type WorkspaceId } from "@propi/core";
import { createDbAdmin, createDbPorts } from "@propi/db";
import { parseWorkspaceSettings } from "../src/server/settings-form.ts";
import { parseWorkspaceLanguage, saveMemberLanguage } from "../src/server/language.ts";
import { resolveRequestLocale } from "../src/i18n/resolve.ts";
import { meta } from "../src/i18n/meta.messages.ts";
import { site } from "../src/content/site.ts";
import { createTestDatabase, hasDatabase, type TestDatabase } from "../../../packages/db/test/pg.ts";

const WS = "ws-1" as WorkspaceId;
const ana = "ana" as MemberId;
const directoryOf = (record: Partial<MemberRecord> | null, language?: "en" | "es"): Pick<Directory, "member" | "settings"> => ({
  member: async () => (record === null ? null : { id: ana, role: "member", active: true, dailyLimitOverride: null, ...record }),
  settings: async () => defaultSettings(language === undefined ? {} : { language }),
});

describe("i18n S3 web request locale", () => {
  test("signed out: the propi_locale cookie, then Accept-Language (es-PE, es-419 → es; en-US → en)", async () => {
    const dir = directoryOf(null);
    expect(await resolveRequestLocale({ cookie: "es", acceptLanguage: "en-US", viewer: null, directory: dir })).toBe("es");
    expect(await resolveRequestLocale({ cookie: undefined, acceptLanguage: "es-PE,es;q=0.9", viewer: null, directory: dir })).toBe("es");
    expect(await resolveRequestLocale({ cookie: undefined, acceptLanguage: "es-419", viewer: null, directory: dir })).toBe("es");
    expect(await resolveRequestLocale({ cookie: undefined, acceptLanguage: "en-US,en;q=0.9", viewer: null, directory: dir })).toBe("en");
    expect(await resolveRequestLocale({ cookie: undefined, acceptLanguage: null, viewer: null, directory: dir })).toBe("en");
  });

  test("signed in: member choice → Slack locale → workspace default → en (the cookie no longer decides)", async () => {
    const viewer = { ws: WS, memberId: ana };
    const at = (record: Partial<MemberRecord>, ws?: "en" | "es") => resolveRequestLocale({ cookie: "en", acceptLanguage: "en-US", viewer, directory: directoryOf(record, ws) });
    expect(await at({ language: "es", slackLocale: "en-US" }, "en")).toBe("es");
    expect(await at({ slackLocale: "es-LA" }, "en")).toBe("es");
    expect(await at({}, "es")).toBe("es");
    expect(await at({})).toBe("en");
  });

  test("a directory failure falls back to the signed-out rules instead of breaking the page", async () => {
    const broken: Pick<Directory, "member" | "settings"> = { member: async () => Promise.reject(new Error("db down")), settings: async () => defaultSettings() };
    expect(await resolveRequestLocale({ cookie: "es", acceptLanguage: null, viewer: { ws: WS, memberId: ana }, directory: broken })).toBe("es");
  });
});

describe("i18n S4 root metadata", () => {
  test("the English defaults stay the site's tagline and description; Spanish has its own", () => {
    expect(meta.t("en")("title.default")).toBe(`${site.name}: ${site.tagline}`);
    expect(meta.t("en")("description")).toBe(site.description);
    expect(meta.t("es")("title.default")).toMatch(/^Propi: /);
    expect(meta.t("es")("description")).not.toBe(site.description);
  });
});

describe("i18n S4b admin workspace language", () => {
  test("en and es are accepted; anything else is an invalid field", () => {
    const form = (v: string) => {
      const f = new FormData();
      f.set("language", v);
      return f;
    };
    expect(parseWorkspaceLanguage(form("es"))).toEqual({ ok: true, value: "es" });
    expect(parseWorkspaceLanguage(form("en"))).toEqual({ ok: true, value: "en" });
    expect(parseWorkspaceLanguage(form("auto"))).toEqual({ ok: false, error: { code: "invalid_field", field: "language" } });
  });

  test("saving the currency form keeps the workspace language", () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ primaryEmoji: ":taco:", singular: "taco", plural: "tacos", extraEmojis: "", timezone: "UTC", defaultDailyAllowance: "5", adminDailyAllowance: "5" })) f.set(k, v);
    const r = parseWorkspaceSettings(f, defaultSettings({ language: "es" }));
    expect(r.ok && r.value.language).toBe("es");
  });
});

describe("i18n S4c member language choice", () => {
  test("a valid choice is stored for the viewer; an invalid one stores nothing", async () => {
    const calls: [WorkspaceId, MemberId, LanguageChoice][] = [];
    const admin = { setMemberLanguage: async (ws: WorkspaceId, id: MemberId, c: LanguageChoice) => void calls.push([ws, id, c]) };
    expect(await saveMemberLanguage(admin, { ws: WS, memberId: ana }, "es")).toEqual({ ok: true, value: "es" });
    expect(await saveMemberLanguage(admin, { ws: WS, memberId: ana }, "klingon")).toEqual({ ok: false, error: { code: "invalid_field", field: "language" } });
    expect(calls).toEqual([[WS, ana, "es"]]);
  });
});

let db: TestDatabase | undefined;
beforeAll(async () => {
  if (hasDatabase) db = await createTestDatabase();
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

describe.skipIf(!hasDatabase)("i18n S4c member language on Postgres", () => {
  test("saveMemberLanguage through the db admin changes what the member reads; auto goes back to the Slack locale", async () => {
    const admin = createDbAdmin(db!.client());
    const { directory } = createDbPorts(db!.client());
    await admin.addWorkspace(WS, defaultSettings({ language: "en" }));
    await admin.addMember(WS, { id: ana, role: "member", active: true, dailyLimitOverride: null, slackLocale: "es-LA" });
    const viewer = { ws: WS, memberId: ana };
    const locale = () => resolveRequestLocale({ cookie: undefined, acceptLanguage: null, viewer, directory });
    expect(await locale()).toBe("es");
    await saveMemberLanguage(admin, viewer, "en");
    expect(await locale()).toBe("en");
    await saveMemberLanguage(admin, viewer, "auto");
    expect(await locale()).toBe("es");
  });
});
