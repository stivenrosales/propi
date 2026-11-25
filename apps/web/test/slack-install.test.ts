// S2 "Add to Slack" (OAuth v2): the install URL, the signed state, the code exchange and the stored
// installation (installer is first admin; a reinstall refreshes the token and never changes roles).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDbInstallations, createDbPorts, createSecretCipher, slackBotCredentials, type DbInstallations, type InstallInput } from "@propi/db";
import { signValue } from "../src/server/session.ts";
import { BOT_SCOPES, checkInstallState, completeInstall, installUrl, newInstallState } from "../src/server/slack-install.ts";
import { createTestDatabase, hasDatabase, type TestDatabase } from "../../../packages/db/test/pg.ts";

const SECRET = "test-secret-0123456789abcdef0123456789";
const NOW = Date.UTC(2026, 10, 25, 15);
const cfg = { clientId: "123.456", clientSecret: "shh", redirectUri: "https://propihq.com/slack/oauth/callback" };

/** A fake Slack: oauth.v2.access answers `access`, users.info answers `tz`. Records every call. */
function fakeSlack(access: Record<string, unknown>, tz: string | null = "America/Bogota") {
  const calls: { url: string; body: string | null; auth: string | null }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body?.toString() ?? null, auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null });
    const json = url.includes("oauth.v2.access") ? access : { ok: true, user: tz === null ? {} : { tz } };
    return new Response(JSON.stringify(json));
  };
  return { fetchImpl, calls };
}

const access = (team: string, installer: string, token: string) => ({
  ok: true,
  token_type: "bot",
  access_token: token,
  bot_user_id: "U0PROPIBOT",
  scope: "chat:write,commands",
  team: { id: team, name: "Acme" },
  authed_user: { id: installer },
});

describe("install URL and state (S2)", () => {
  test("the authorize URL asks for the manifest's bot scopes with our redirect and state", () => {
    const u = new URL(installUrl(cfg, "st-1"));
    expect(`${u.origin}${u.pathname}`).toBe("https://slack.com/oauth/v2/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: "123.456", scope: BOT_SCOPES.join(","), redirect_uri: cfg.redirectUri, state: "st-1" });
    const manifest = readFileSync(join(import.meta.dirname, "..", "..", "..", "deploy", "slack-manifest.yml"), "utf8");
    const bot = /\n {4}bot:\n((?: {6}- .+\n)+)/.exec(manifest)![1]!.trim().split("\n").map((l) => l.replace(/^\s*- /, "").trim());
    expect([...BOT_SCOPES]).toEqual(bot);
  });

  test("only the unexpired, signed cookie with the same state passes", () => {
    const { state, cookie } = newInstallState(SECRET, NOW);
    expect(checkInstallState(SECRET, cookie, state, NOW + 60_000)).toBe(true);
    expect(checkInstallState(SECRET, cookie, "other-state", NOW)).toBe(false);
    expect(checkInstallState(SECRET, cookie, null, NOW)).toBe(false);
    expect(checkInstallState(SECRET, undefined, state, NOW)).toBe(false);
    expect(checkInstallState(SECRET, cookie, state, NOW + 11 * 60_000)).toBe(false);
    expect(checkInstallState("another-secret-0123456789abcdef0123", cookie, state, NOW)).toBe(false);
    // A value signed for another purpose (the sign-in state) is not an install state.
    expect(checkInstallState(SECRET, signValue(SECRET, "propi.oidc.v1", { state, exp: NOW + 60_000 }), state, NOW)).toBe(false);
  });
});

describe("completeInstall (S2)", () => {
  test("a refused code stores nothing", async () => {
    const stored: InstallInput[] = [];
    const slack = fakeSlack({ ok: false, error: "invalid_code" });
    const r = await completeInstall({ installations: { bootstrap: async (i) => (stored.push(i), { workspaceId: "w" as never, created: true, installerMemberId: null }) }, fallbackTimezone: "UTC", now: () => NOW, fetch: slack.fetchImpl }, cfg, "c");
    expect(r).toEqual({ ok: false, error: "invalid_code" });
    expect(stored).toEqual([]);
  });

  test("the timezone falls back to PROPI_TIMEZONE when the installer's profile has none", async () => {
    const stored: InstallInput[] = [];
    const slack = fakeSlack(access("T0ACME0001", "U0INSTALL1", "xoxb-acme"), null);
    await completeInstall({ installations: { bootstrap: async (i) => (stored.push(i), { workspaceId: "w" as never, created: true, installerMemberId: null }) }, fallbackTimezone: "America/Lima", now: () => NOW, fetch: slack.fetchImpl }, cfg, "c");
    expect(stored[0]?.settings).toEqual({ timezone: "America/Lima" });
    expect(slack.calls[0]?.body).toContain("redirect_uri=https%3A%2F%2Fpropihq.com%2Fslack%2Foauth%2Fcallback");
    expect(slack.calls[1]).toMatchObject({ url: "https://slack.com/api/users.info?user=U0INSTALL1", auth: "Bearer xoxb-acme" });
  });
});

let db: TestDatabase | undefined;
let installs: DbInstallations;
beforeAll(async () => {
  if (!hasDatabase) return;
  db = await createTestDatabase();
  let n = 0;
  installs = createDbInstallations(db.client(), { cipher: createSecretCipher("33".repeat(32)), ids: { next: (kind) => `${kind}-${++n}` } });
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

describe.skipIf(!hasDatabase)("completeInstall on Postgres (S2, S5)", () => {
  const deps = (fetchImpl: ReturnType<typeof fakeSlack>["fetchImpl"]) => ({ installations: installs, fallbackTimezone: "UTC", now: () => NOW, fetch: fetchImpl });

  test("the first install creates the workspace in the installer's timezone, installer first admin, token encrypted", async () => {
    const r = await completeInstall(deps(fakeSlack(access("T0ACME0001", "U0INSTALL1", "xoxb-acme")).fetchImpl), cfg, "code-1");
    expect(r).toMatchObject({ ok: true, created: true });
    if (!r.ok) return;
    const ports = createDbPorts(db!.client());
    expect((await ports.directory.settings(r.workspaceId)).timezone).toBe("America/Bogota");
    expect((await ports.directory.members(r.workspaceId)).map((m) => m.role)).toEqual(["admin"]);
    const stored = await installs.find("slack", "T0ACME0001");
    expect(stored?.installation).toEqual({ teamId: "T0ACME0001", teamName: "Acme", botToken: "xoxb-acme", botUserId: "U0PROPIBOT", scopes: ["chat:write", "commands"], installerUserId: "U0INSTALL1" });
    const [row] = await db!.client().$queryRaw<{ data_enc: string }[]>`SELECT data_enc FROM installation WHERE tenant_id = 'T0ACME0001'`;
    expect(row?.data_enc).not.toContain("xoxb");
  });

  test("a reinstall by someone else after an uninstall refreshes the token and keeps roles", async () => {
    await installs.markUninstalled("slack", "T0ACME0001", (NOW + 1) as never);
    const r = await completeInstall(deps(fakeSlack(access("T0ACME0001", "U0SOMEONE1", "xoxb-acme-2")).fetchImpl), cfg, "code-2");
    expect(r).toMatchObject({ ok: true, created: false });
    const stored = await installs.find("slack", "T0ACME0001");
    expect(stored?.uninstalledAt).toBeNull();
    expect(slackBotCredentials(stored?.installation)).toEqual({ botToken: "xoxb-acme-2", botUserId: "U0PROPIBOT" });
    expect((await createDbPorts(db!.client()).directory.members(stored!.workspaceId)).map((m) => m.role)).toEqual(["admin"]);
  });
});
