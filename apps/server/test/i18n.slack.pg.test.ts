// i18n S1, S4d on Postgres: DMs, App Home and ephemeral replies are written in the recipient member's
// language (their choice → Slack locale → workspace default → en); channel posts in the workspace default.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Instant, OutboxEvent, WorkspaceId } from "@propi/app";
import { createSecretCipher } from "@propi/db";
import type { SlackEnvelope, SlackSlashCommand } from "@propi/slack";
import { handleEvent, handleSlash, type InboundDeps } from "../src/inbound.ts";
import { createSlackLookup, provisionedMemberId } from "../src/lookup.ts";
import { relayOnce, renderContexts, slackDeliveriesFor } from "../src/relay.ts";
import { createRuntime, type Runtime } from "../src/runtime.ts";
import { fakeSlack, fixture, gatewayOf, installTeam } from "./fakes.ts";
import { createTestDatabase, hasDatabase } from "./pg.ts";

const TEAM = "T0PROPI001";
const T0 = Date.UTC(2026, 10, 25, 15, 0, 0);
const ORIGINAL = { "C0GENERAL1:1764082800.000100": { user: "U0GIVER001", botId: null, text: "<@U0ANA00001> <@U0DIANA001> gracias :taco::taco:" } };

let db: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
let rt: Runtime;
let ws: WorkspaceId;
let d: InboundDeps;
const slack = fakeSlack({
  messages: ORIGINAL,
  profiles: { U0ANA00001: { displayName: "ana", avatarUrl: null, slackLocale: "es-LA" }, U0GIVER001: { displayName: "Gio", avatarUrl: null, slackLocale: "en-US" } },
});
const member = (user: string) => provisionedMemberId(ws, TEAM, user);
const celebrated = (post: "channel" | "dm"): OutboxEvent =>
  ({
    id: `evt-${post}`,
    workspaceId: ws,
    type: "milestone.celebrated",
    at: T0,
    data: { memberId: member("U0ANA00001"), kind: "birthday", date: "2026-11-25", years: null, post, channelId: post === "channel" ? "C0GENERAL1" : null },
  }) as unknown as OutboxEvent;

beforeAll(async () => {
  if (!hasDatabase) return;
  db = await createTestDatabase();
  let n = 0;
  rt = createRuntime(db.client, { cipher: createSecretCipher("00".repeat(32)), clock: { now: () => T0 as Instant }, ids: { next: (kind) => `${kind}-${++n}` } });
  const gateway = gatewayOf(rt, { [TEAM]: slack.api });
  d = { rt, lookup: createSlackLookup(rt, gateway), slack: gateway, appUrl: "https://propi.example", log: () => undefined };
  ws = await installTeam(rt, { team: TEAM, installer: "U0BOSS0001", now: T0 });
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

describe.skipIf(!hasDatabase)("i18n S4d Slack messages follow the reader's language", () => {
  test("a gift's DMs: Ana (Slack in Spanish) reads Spanish, the giver (Slack in English) reads English", async () => {
    await handleEvent(d, fixture<SlackEnvelope>("message.channels.gift.json"));
    await relayOnce({ ...d, appUrl: null });
    expect(slack.take().map((p) => [p.channel, p.text])).toEqual([
      ["DM:U0GIVER001", "You gave :taco: 4 tacos. You have 1 taco left to give today."],
      ["DM:U0ANA00001", "<@U0GIVER001> te dio :taco: 2 tacos en <#C0GENERAL1>."],
      ["DM:U0DIANA001", "<@U0GIVER001> gave you :taco: 2 tacos in <#C0GENERAL1>."],
    ]);
  });

  test("/propi and the App Home answer in the member's language", async () => {
    expect((await handleSlash(d, fixture<SlackSlashCommand>("slash.balance.json"))).text).toBe("Puedes canjear 2 tacos y dar 5 tacos más hoy.");
    await handleEvent(d, fixture<SlackEnvelope>("app_home_opened.json"));
    expect(JSON.stringify(slack.homes.at(-1)!.blocks)).toContain("*Puedes canjear*\\n:taco: 2");
  });

  test("a channel post uses the workspace default while a DM uses the member's own choice", async () => {
    await rt.admin.updateSettings(ws, (s) => ({ ...s, language: "es" }));
    await rt.admin.setMemberLanguage(ws, member("U0ANA00001"), "en");
    const ctxs = await renderContexts(d, ws);
    const [post] = await slackDeliveriesFor(d, celebrated("channel"), ctxs);
    const [dm] = await slackDeliveriesFor(d, celebrated("dm"), ctxs);
    expect(post).toEqual({ target: { kind: "channel", channel: "C0GENERAL1" }, body: expect.objectContaining({ text: ":birthday: ¡Feliz cumpleaños, <@U0ANA00001>!" }) });
    expect(dm).toEqual({ target: { kind: "dm", to: member("U0ANA00001") }, body: expect.objectContaining({ text: ":birthday: Happy birthday, <@U0ANA00001>!" }) });
  });
});
