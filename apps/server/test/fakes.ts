// A recording fake of the Slack Web API port, and fixture loading from packages/slack.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SlackApi, SlackUserInfo } from "../src/slack-api.ts";

export const fixture = <T = never>(name: string): T =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "packages", "slack", "test", "fixtures", name), "utf8")) as T;

export interface Posted {
  readonly channel: string;
  readonly text: string;
  readonly blocks: readonly unknown[];
}

export function fakeSlack(opts: { readonly teamId?: string; readonly bots?: readonly string[]; readonly messages?: Record<string, { user: string | null; botId: string | null; text: string }> } = {}) {
  const posted: Posted[] = [];
  const homes: { user: string; blocks: readonly unknown[] }[] = [];
  const api: SlackApi = {
    authTest: async () => ({ teamId: opts.teamId ?? "T0PROPI001", botUserId: "U0PROPIBOT" }),
    userInfo: async (id): Promise<SlackUserInfo | null> => ({ id, isBot: opts.bots?.includes(id) ?? false, deleted: false }),
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
