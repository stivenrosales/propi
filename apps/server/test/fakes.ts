// A recording fake of the Slack Web API port, and fixture loading from packages/slack.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Instant, WorkspaceId } from "@propi/app";
import { installationGateway, type SlackGateway } from "../src/gateway.ts";
import { adoptEnvToken } from "../src/install.ts";
import type { Runtime } from "../src/runtime.ts";
import type { SlackApi, SlackUserInfo } from "../src/slack-api.ts";

export const fixture = <T = never>(name: string): T =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "packages", "slack", "test", "fixtures", name), "utf8")) as T;

export interface Posted {
  readonly channel: string;
  readonly text: string;
  readonly blocks: readonly unknown[];
}

type FakeProfile = { readonly displayName: string | null; readonly avatarUrl: string | null; readonly slackLocale?: string };

export function fakeSlack(
  opts: {
    readonly teamId?: string;
    readonly bots?: readonly string[];
    readonly messages?: Record<string, { user: string | null; botId: string | null; text: string }>;
    /** S6: Slack profiles by user id; users.list returns exactly these. */
    readonly profiles?: Record<string, FakeProfile>;
  } = {},
) {
  const posted: Posted[] = [];
  const homes: { user: string; blocks: readonly unknown[] }[] = [];
  const api: SlackApi = {
    authTest: async () => ({ teamId: opts.teamId ?? "T0PROPI001", botUserId: "U0PROPIBOT" }),
    userInfo: async (id): Promise<SlackUserInfo | null> => ({ id, isBot: opts.bots?.includes(id) ?? false, deleted: false, ...opts.profiles?.[id] }),
    usersList: async () => Object.entries(opts.profiles ?? {}).map(([id, p]) => ({ id, isBot: opts.bots?.includes(id) ?? false, deleted: false, ...p })),
    usergroupUsers: async () => ["U0ANA00001", "U0BOB00001"],
    message: async (channel, ts) => opts.messages?.[`${channel}:${ts}`] ?? null,
    channelInfo: async (c) => ({ isPrivate: c.startsWith("G"), isIm: c.startsWith("D"), isMpim: false }),
    channelMembers: async () => [],
    openConversation: async (users) => `DM:${[...users].sort().join(",")}`,
    postMessage: async (channel, body) => void posted.push({ channel, text: body.text, blocks: body.blocks }),
    postEphemeral: async (channel, _user, body) => void posted.push({ channel, text: body.text, blocks: body.blocks }),
    publishHome: async (user, view) => void homes.push({ user, blocks: view.blocks }),
  };
  return { api, posted, homes, take: () => posted.splice(0, posted.length) };
}

/** The bot token a test team is installed with. */
export const tokenOf = (team: string) => `xoxb-test-${team}`;

/** Installs a Slack team with its own bot token (stored encrypted, as the OAuth install does); installer is first admin. */
export async function installTeam(rt: Runtime, o: { readonly team: string; readonly installer: string; readonly timezone?: string; readonly now: number }): Promise<WorkspaceId> {
  const r = await adoptEnvToken(rt, { teamId: o.team, botToken: tokenOf(o.team), botUserId: "U0PROPIBOT", installerUserId: o.installer, timezone: o.timezone ?? "America/Lima", now: o.now as Instant });
  return r.workspaceId!;
}

/** The real installation gateway, with each team's bot token mapped to a fake Slack client. */
export function gatewayOf(rt: Runtime, byTeam: Record<string, SlackApi>): SlackGateway {
  const byToken = new Map(Object.entries(byTeam).map(([team, api]) => [tokenOf(team), api]));
  return installationGateway(rt, (token) => {
    const api = byToken.get(token);
    if (api === undefined) throw new Error(`no fake Slack for token ${token}`);
    return api;
  });
}
