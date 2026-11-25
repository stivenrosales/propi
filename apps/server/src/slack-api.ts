// The Slack Web API calls the server makes, as a narrow port so tests can fake Slack. The real
// implementation wraps @slack/bolt's WebClient.
import type { webApi } from "@slack/bolt";

type WebClient = webApi.WebClient;

export interface SlackUserInfo {
  readonly id: string;
  readonly isBot: boolean;
  readonly deleted: boolean;
}

export interface SlackApi {
  authTest(): Promise<{ readonly teamId: string; readonly botUserId: string }>;
  userInfo(user: string): Promise<SlackUserInfo | null>;
  usergroupUsers(group: string): Promise<readonly string[]>;
  /** The message at `ts` in `channel` (top-level or in a thread). */
  message(channel: string, ts: string): Promise<{ readonly user: string | null; readonly botId: string | null; readonly text: string } | null>;
  channelInfo(channel: string): Promise<{ readonly isPrivate: boolean; readonly isIm: boolean; readonly isMpim: boolean } | null>;
  channelMembers(channel: string): Promise<readonly string[]>;
  /** Opens (or reuses) a DM or group DM with these users; returns the channel id. */
  openConversation(users: readonly string[]): Promise<string>;
  postMessage(channel: string, body: { readonly text: string; readonly blocks: readonly unknown[] }): Promise<void>;
  postEphemeral(channel: string, user: string, body: { readonly text: string; readonly blocks: readonly unknown[] }): Promise<void>;
  publishHome(user: string, view: { readonly type: "home"; readonly blocks: readonly unknown[] }): Promise<void>;
}

/** Errors that will not get better on retry: the target is gone or unreachable for the bot. */
export function isPermanentSlackError(err: unknown): boolean {
  const code = (err as { data?: { error?: string } } | null)?.data?.error;
  return (
    code !== undefined &&
    ["channel_not_found", "user_not_found", "not_in_channel", "is_archived", "cannot_dm_bot", "user_disabled", "account_inactive", "invalid_blocks", "msg_too_long", "no_text"].includes(code)
  );
}

export function webSlackApi(client: WebClient): SlackApi {
  return {
    async authTest() {
      const r = await client.auth.test();
      if (r.team_id === undefined || r.user_id === undefined) throw new Error("auth.test returned no team or user");
      return { teamId: r.team_id, botUserId: r.user_id };
    },
    async userInfo(user) {
      try {
        const r = await client.users.info({ user });
        const u = r.user;
        if (u === undefined) return null;
        return { id: user, isBot: u.is_bot === true || user === "USLACKBOT", deleted: u.deleted === true };
      } catch (err) {
        if (isPermanentSlackError(err)) return null;
        throw err;
      }
    },
    async usergroupUsers(usergroup) {
      const r = await client.usergroups.users.list({ usergroup });
      return r.users ?? [];
    },
    async message(channel, ts) {
      try {
        const h = await client.conversations.history({ channel, latest: ts, oldest: ts, inclusive: true, limit: 1 });
        let m = h.messages?.find((x) => x.ts === ts);
        if (m === undefined) {
          const r = await client.conversations.replies({ channel, ts, latest: ts, inclusive: true, limit: 1 });
          m = r.messages?.find((x) => x.ts === ts);
        }
        return m === undefined ? null : { user: m.user ?? null, botId: m.bot_id ?? null, text: m.text ?? "" };
      } catch (err) {
        if (isPermanentSlackError(err)) return null;
        throw err;
      }
    },
    async channelInfo(channel) {
      try {
        const r = await client.conversations.info({ channel });
        const c = r.channel;
        return c === undefined ? null : { isPrivate: c.is_private === true, isIm: c.is_im === true, isMpim: c.is_mpim === true };
      } catch (err) {
        if (isPermanentSlackError(err)) return null;
        throw err;
      }
    },
    async channelMembers(channel) {
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const r = await client.conversations.members({ channel, limit: 1000, ...(cursor === undefined ? {} : { cursor }) });
        out.push(...(r.members ?? []));
        cursor = r.response_metadata?.next_cursor || undefined;
      } while (cursor !== undefined);
      return out;
    },
    async openConversation(users) {
      const r = await client.conversations.open({ users: users.join(",") });
      const id = r.channel?.id;
      if (id === undefined) throw new Error("conversations.open returned no channel");
      return id;
    },
    async postMessage(channel, body) {
      await client.chat.postMessage({ channel, text: body.text, blocks: body.blocks as never, unfurl_links: false });
    },
    async postEphemeral(channel, user, body) {
      await client.chat.postEphemeral({ channel, user, text: body.text, blocks: body.blocks as never });
    },
    async publishHome(user_id, view) {
      await client.views.publish({ user_id, view: view as never });
    },
  };
}
