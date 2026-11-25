// S3 S4: one process serves every installed workspace, each with its own bot token. No code path
// sends with another workspace's token; an uninstall stops only that workspace; a manual install's
// SLACK_BOT_TOKEN is adopted once.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Instant, WorkspaceId } from "@propi/app";
import { createSecretCipher } from "@propi/db";
import type { SlackEnvelope } from "@propi/slack";
import { boltAuthorize } from "../src/bolt.ts";
import type { SlackGateway } from "../src/gateway.ts";
import { handleEvent, type InboundDeps } from "../src/inbound.ts";
import { adoptEnvToken } from "../src/install.ts";
import { createSlackLookup, provisionedMemberId } from "../src/lookup.ts";
import { relayOnce } from "../src/relay.ts";
import { createRuntime, type Runtime } from "../src/runtime.ts";
import { fakeSlack, fixture, gatewayOf, installTeam, tokenOf } from "./fakes.ts";
import { createTestDatabase, hasDatabase } from "./pg.ts";

const A = "T0AAAAAAA1";
const B = "T0BBBBBBB1";
const T0 = Date.UTC(2026, 10, 25, 15, 0, 0);

let db: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
let rt: Runtime;
let wsA: WorkspaceId;
let wsB: WorkspaceId;
let gateway: SlackGateway;
let d: InboundDeps;
const slackA = fakeSlack({ teamId: A });
// In workspace B the same user id is a bot: a lookup cache shared across teams would leak A's answer.
const slackB = fakeSlack({ teamId: B, bots: ["U0ANA00001"] });

type Raw = { event: Record<string, unknown> } & Record<string, unknown>;
const envFor = (name: string, team: string, mutate: (e: Raw) => void = () => undefined): SlackEnvelope => {
  const e = fixture<Raw>(name);
  e["team_id"] = team;
  e.event["team"] = team;
  e["event_id"] = `${String(e["event_id"])}-${team}`;
  mutate(e);
  return e as unknown as SlackEnvelope;
};
const relay = () => relayOnce({ ...d, appUrl: null });

beforeAll(async () => {
  if (!hasDatabase) return;
  db = await createTestDatabase();
  let n = 0;
  rt = createRuntime(db.client, { cipher: createSecretCipher("22".repeat(32)), clock: { now: () => T0 as Instant }, ids: { next: (kind) => `${kind}-${++n}` } });
  wsA = await installTeam(rt, { team: A, installer: "U0BOSSA001", now: T0 });
  wsB = await installTeam(rt, { team: B, installer: "U0BOSSB001", now: T0 });
  gateway = gatewayOf(rt, { [A]: slackA.api, [B]: slackB.api });
  d = { rt, lookup: createSlackLookup(rt, gateway), slack: gateway, appUrl: null, log: () => undefined };
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

describe.skipIf(!hasDatabase)("multi-tenant runtime (S3)", () => {
  test("S3: active installations are the served workspaces; each resolves its own token", async () => {
    expect((await rt.installations.active("slack")).map((i) => i.workspaceId).sort()).toEqual([wsA, wsB].sort());
    expect(await gateway.auth(A)).toMatchObject({ teamId: A, workspaceId: wsA, botToken: tokenOf(A) });
    expect(await gateway.forWorkspace(wsB)).toBe(slackB.api);
    expect(await boltAuthorize(gateway)({ teamId: B })).toEqual({ botToken: tokenOf(B), botUserId: "U0PROPIBOT", teamId: B });
    await expect(boltAuthorize(gateway)({ teamId: "T0UNKNOWN1" })).rejects.toThrow(/no active Propi installation/);
  });

  test("S3: gifts in two workspaces are relayed with each workspace's own client, never the other's", async () => {
    expect((await handleEvent(d, envFor("message.channels.gift.json", A))).result).toMatchObject({ ok: true });
    expect((await handleEvent(d, envFor("message.channels.gift.json", B))).result).toMatchObject({ ok: true, value: { perReceiver: 2, totalCost: 2 } });
    // Users are per team: the bot in B was never provisioned as a member there.
    expect(await rt.ports.directory.member(wsB, provisionedMemberId(wsB, B, "U0ANA00001"))).toBeNull();

    expect((await relay()).slackEvents).toBe(2);
    expect(slackA.take().map((p) => p.channel)).toEqual(["DM:U0GIVER001", "DM:U0ANA00001", "DM:U0DIANA001"]);
    expect(slackB.take().map((p) => p.channel)).toEqual(["DM:U0GIVER001", "DM:U0DIANA001"]);
  });

  test("S3: the App Home is published with the team's own client", async () => {
    await handleEvent(d, envFor("app_home_opened.json", B, (e) => void (e.event["user"] = "U0GIVER001")));
    expect(slackB.homes.map((h) => h.user)).toEqual(["U0GIVER001"]);
    expect(slackA.homes).toEqual([]);
  });

  test("S3 S72: an uninstall marks only that installation and stops its sends; the other keeps working", async () => {
    await handleEvent(d, envFor("message.channels.gift.json", A, (e) => void ((e["event_id"] = "Ev-A-2"), (e.event["client_msg_id"] = "00000000-0000-4000-8000-0000000000a2"), (e.event["ts"] = "1764082900.000100"))));
    await handleEvent(d, envFor("app_uninstalled.json", A));
    expect((await rt.installations.find("slack", A))?.uninstalledAt).not.toBeNull();
    expect((await rt.installations.find("slack", B))?.uninstalledAt).toBeNull();
    expect(await gateway.forTeam(A)).toBeNull();
    expect((await rt.installations.active("slack")).map((i) => i.workspaceId)).toEqual([wsB]);

    await handleEvent(d, envFor("message.channels.gift.json", B, (e) => void ((e["event_id"] = "Ev-B-2"), (e.event["client_msg_id"] = "00000000-0000-4000-8000-0000000000b2"), (e.event["ts"] = "1764082900.000100"))));
    await relay();
    expect(slackA.take()).toEqual([]);
    expect(slackB.take().length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasDatabase)("Pearson migration: SLACK_BOT_TOKEN adopt-once (S4)", () => {
  const base = { botUserId: "U0PROPIBOT", timezone: "America/Lima", now: T0 as Instant };

  test("S4: a pre-cloud installation without a token adopts the env token once; later starts keep it", async () => {
    const legacy = await rt.installations.bootstrap({ platform: "slack", tenantId: "T0PEARSON1", installerUserId: "U0PBOSS001", at: T0 as Instant, installation: { teamId: "T0PEARSON1" } });
    const first = await adoptEnvToken(rt, { ...base, teamId: "T0PEARSON1", botToken: "xoxb-pearson", installerUserId: null });
    expect(first).toEqual({ outcome: "adopted", workspaceId: legacy.workspaceId });
    expect((await rt.installations.find("slack", "T0PEARSON1"))?.installation).toMatchObject({ teamId: "T0PEARSON1", botToken: "xoxb-pearson", botUserId: "U0PROPIBOT" });

    const second = await adoptEnvToken(rt, { ...base, teamId: "T0PEARSON1", botToken: "xoxb-stale", installerUserId: "U0SOMEONE1" });
    expect(second).toEqual({ outcome: "kept", workspaceId: legacy.workspaceId });
    expect((await rt.installations.find("slack", "T0PEARSON1"))?.installation).toMatchObject({ botToken: "xoxb-pearson" });
    expect((await rt.ports.directory.members(legacy.workspaceId)).map((m) => m.role)).toEqual(["admin"]);
  });

  test("S4 S5: no installation creates the workspace only with SLACK_INSTALLER_USER_ID; otherwise it is skipped", async () => {
    expect(await adoptEnvToken(rt, { ...base, teamId: "T0NOINST01", botToken: "xoxb-x", installerUserId: null })).toEqual({ outcome: "skipped", workspaceId: null });
    expect(await rt.installations.find("slack", "T0NOINST01")).toBeNull();

    const created = await adoptEnvToken(rt, { ...base, teamId: "T0NEWINST1", botToken: "xoxb-new", installerUserId: "U0NEWBOSS1" });
    expect(created.outcome).toBe("created");
    expect((await rt.ports.directory.members(created.workspaceId!)).map((m) => m.role)).toEqual(["admin"]);
    expect((await rt.ports.directory.settings(created.workspaceId!)).timezone).toBe("America/Lima");
  });
});
