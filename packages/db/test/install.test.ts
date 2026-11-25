// S5 workspace bootstrap from a platform install, and the installation store (S72).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApiTokens, createApp, createIdentities, nodeCrypto, type CommandKey, type Instant, type MemberId, type PosInt, type WorkspaceId } from "@propi/app";
import { createDbIdentityStore, createDbInstallations, createDbPorts, createSecretCipher, slackBotCredentials, type DbInstallations, type PrismaClient } from "../src/index.ts";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./pg.ts";
import { T0 } from "./harness.ts";

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

const cipher = createSecretCipher("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const slackInstall = (team: string, user: string, token = "xoxb-secret-token") => ({
  platform: "slack" as const,
  tenantId: team,
  installerUserId: user,
  at: T0,
  settings: { timezone: "America/Lima" },
  installation: { team: { id: team }, bot: { token, userId: "UBOT" } },
});

describe.skipIf(!hasDatabase)("workspace bootstrap (S5)", () => {
  let installs: DbInstallations;
  beforeAll(() => {
    let n = 0;
    installs = createDbInstallations(pg!, { cipher, ids: { next: (kind) => `${kind}-${++n}` } });
  });

  test("S5: the first install creates the workspace and makes the installer its first admin", async () => {
    const r = await installs.bootstrap(slackInstall("T1", "U1"));
    expect(r).toEqual({ workspaceId: "workspace-1", created: true, installerMemberId: "member-2" });
    const ports = createDbPorts(pg!);
    expect(await ports.directory.members(r.workspaceId)).toEqual([{ id: "member-2", role: "admin", active: true, dailyLimitOverride: null }]);
    expect((await ports.directory.settings(r.workspaceId)).timezone).toBe("America/Lima");

    // The installer is a working admin: their Slack identity resolves to an admin actor that can adjust.
    const identities = createIdentities({ store: createDbIdentityStore(pg!), directory: ports.directory });
    const actor = await identities.actorFor(r.workspaceId, { platform: "slack", tenantId: "T1", userId: "U1" });
    expect(actor).toEqual({ kind: "member", memberId: "member-2", role: "admin" });
    const bonus = await createApp(ports).execute({ type: "GrantBonus", key: "adm:first" as CommandKey, workspaceId: r.workspaceId, actor: actor!, at: T0, memberIds: ["member-2" as MemberId], amount: 5 as PosInt, reason: "hello" });
    expect(bonus.ok).toBe(true);
    const tokens = createApiTokens({ store: { get: async () => null, list: async () => [], save: async () => undefined }, crypto: nodeCrypto, clock: { now: () => T0 }, ids: { next: () => "t" } });
    expect((await tokens.issue(actor!, r.workspaceId, { name: "x", scopes: ["members:read"] })).ok).toBe(true);
  });

  test("S5: installing again is idempotent and never changes roles; another installer is not made admin", async () => {
    const again = await installs.bootstrap(slackInstall("T1", "U1", "xoxb-rotated"));
    expect(again).toEqual({ workspaceId: "workspace-1", created: false, installerMemberId: "member-2" });
    // A reinstall refreshes the stored installation (rotated token).
    expect((await installs.find("slack", "T1"))?.installation).toEqual({ team: { id: "T1" }, bot: { token: "xoxb-rotated", userId: "UBOT" } });
    const other = await installs.bootstrap(slackInstall("T1", "U2"));
    expect(other).toEqual({ workspaceId: "workspace-1", created: false, installerMemberId: null });
    const rows = await pg!.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM workspace WHERE id LIKE 'workspace-%'`;
    expect(rows[0]?.n).toBe(1);
    expect(await createDbPorts(pg!).directory.members("workspace-1" as WorkspaceId)).toEqual([{ id: "member-2", role: "admin", active: true, dailyLimitOverride: null }]);
  });

  test("S5: concurrent installs of one tenant create one workspace", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => installs.bootstrap(slackInstall("T-race", "U9"))));
    expect(new Set(results.map((r) => r.workspaceId)).size).toBe(1);
    expect(results.filter((r) => r.created).length).toBe(1);
    expect(new Set(results.map((r) => r.installerMemberId)).size).toBe(1);
  });

  test("the bot token is encrypted at rest", async () => {
    const [row] = await pg!.$queryRaw<{ data_enc: string }[]>`SELECT data_enc FROM installation WHERE tenant_id = 'T1'`;
    expect(row?.data_enc.startsWith("v1.")).toBe(true);
    expect(row?.data_enc).not.toContain("xoxb");
    expect(await installs.find("slack", "T-missing")).toBeNull();
  });

  test("S72: an uninstall stamps the installation and keeps the workspace; a reinstall clears it", async () => {
    const at = (T0 + 60_000) as Instant;
    await installs.markUninstalled("slack", "T1", at);
    const gone = await installs.find("slack", "T1");
    expect(gone?.uninstalledAt).toBe(at);
    expect(gone?.workspaceId).toBe("workspace-1");
    expect((await createDbPorts(pg!).directory.members("workspace-1" as WorkspaceId)).length).toBe(1);
    expect((await installs.bootstrap(slackInstall("T1", "U1"))).created).toBe(false);
    expect((await installs.find("slack", "T1"))?.uninstalledAt).toBeNull();
  });
  test("S2 S3: a reinstall after an uninstall stores the new token, keeps roles; active() and byWorkspace() list installations", async () => {
    await installs.bootstrap(slackInstall("T-two", "U7", "xoxb-two"));
    await installs.markUninstalled("slack", "T-two", (T0 + 1) as Instant);
    expect((await installs.active("slack")).map((i) => i.tenantId)).not.toContain("T-two");

    const ws = (await installs.find("slack", "T-two"))!.workspaceId;
    const r = await installs.bootstrap({ ...slackInstall("T-two", "U8", "xoxb-two-new"), installation: { teamId: "T-two", botToken: "xoxb-two-new", botUserId: "UB2" } });
    expect(r).toEqual({ workspaceId: ws, created: false, installerMemberId: null });
    const back = await installs.byWorkspace("slack", ws);
    expect(back).toMatchObject({ tenantId: "T-two", uninstalledAt: null, installation: { botToken: "xoxb-two-new" } });
    expect(slackBotCredentials(back!.installation)).toEqual({ botToken: "xoxb-two-new", botUserId: "UB2" });
    expect((await createDbPorts(pg!).directory.members(ws)).map((m) => m.role)).toEqual(["admin"]);
    expect((await installs.active("slack")).map((i) => i.tenantId)).toContain("T-two");
    expect(await installs.byWorkspace("slack", "workspace-none" as WorkspaceId)).toBeNull();
  });

  test("slackBotCredentials: rows without a token (pre-cloud { teamId }) have none", () => {
    expect(slackBotCredentials({ teamId: "T1" })).toBeNull();
    expect(slackBotCredentials(null)).toBeNull();
    expect(slackBotCredentials({ botToken: "xoxb-1" })).toEqual({ botToken: "xoxb-1", botUserId: null });
  });
});
