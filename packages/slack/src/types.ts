// The Slack payload shapes this adapter reads (a subset of the Events API and interactivity
// payloads), and the lookup port translation needs. Only fields we use are typed.
import type { Actor, ChannelKind, MemberId, Mention, Value, WorkspaceId, WorkspaceSettings } from "@propi/app";

export interface SlackMessage {
  readonly type: "message";
  readonly subtype?: string;
  readonly channel: string;
  readonly channel_type?: "channel" | "group" | "im" | "mpim" | "app_home";
  readonly user?: string;
  readonly bot_id?: string;
  readonly text?: string;
  readonly ts: string;
  readonly thread_ts?: string;
  readonly edited?: { readonly user: string; readonly ts: string };
  /** message_changed: the new version. */
  readonly message?: Omit<SlackMessage, "channel" | "type"> & { readonly type?: "message" };
  /** message_changed / message_deleted: the version before. */
  readonly previous_message?: Omit<SlackMessage, "channel" | "type"> & { readonly type?: "message" };
  readonly deleted_ts?: string;
  readonly hidden?: boolean;
}

export interface SlackReaction {
  readonly type: "reaction_added" | "reaction_removed";
  readonly user: string;
  readonly reaction: string;
  readonly item_user?: string;
  readonly item: { readonly type: "message" | "file" | "file_comment"; readonly channel?: string; readonly ts?: string };
  readonly event_ts: string;
}

export interface SlackAppHomeOpened {
  readonly type: "app_home_opened";
  readonly user: string;
  readonly tab: "home" | "messages";
}

export interface SlackAppUninstalled {
  readonly type: "app_uninstalled" | "tokens_revoked";
}

export type SlackEvent = SlackMessage | SlackReaction | SlackAppHomeOpened | SlackAppUninstalled | { readonly type: string };

/** The Events API envelope (`event_callback`), as Bolt hands it to listeners in `body`. */
export interface SlackEnvelope<E = SlackEvent> {
  readonly type: "event_callback";
  readonly team_id: string;
  readonly api_app_id?: string;
  readonly event_id: string;
  readonly event_time?: number;
  readonly event: E;
}

export interface SlackSlashCommand {
  readonly team_id: string;
  readonly channel_id: string;
  readonly user_id: string;
  readonly command: string;
  readonly text: string;
  readonly trigger_id: string;
}

export interface SlackBlockAction {
  readonly type: "block_actions";
  readonly team: { readonly id: string } | null;
  readonly user: { readonly id: string; readonly team_id?: string };
  readonly trigger_id: string;
  /** Buttons carry `value`; a static_select (the S2 quantity picker) carries `selected_option`. */
  readonly actions: readonly { readonly action_id: string; readonly value?: string; readonly selected_option?: { readonly value: string }; readonly action_ts: string }[];
}

/** A message the reaction points at: its author and text. */
export interface SlackMessageRef {
  readonly user: string | null;
  readonly botId: string | null;
  readonly text: string;
}

/**
 * Everything translation needs from Slack and the workspace. apps/server implements it with the
 * Web API, the identity store and the Directory; tests implement it with fixtures.
 */
export interface SlackLookup {
  /** The workspace installed for a Slack team, or null when the team is unknown or uninstalled. */
  workspace(teamId: string): Promise<WorkspaceId | null>;
  settings(ws: WorkspaceId): Promise<WorkspaceSettings>;
  values(ws: WorkspaceId): Promise<readonly Value[]>;
  /** The actor behind a Slack user: a member (linked or newly provisioned), a bot, or null. */
  actor(ws: WorkspaceId, teamId: string, userId: string): Promise<Actor | null>;
  /** The mention for `<@U…>`: a member, a bot (S8), or null when it cannot be resolved. */
  mention(ws: WorkspaceId, teamId: string, userId: string): Promise<Mention | null>;
  /** S12: the members of a user group, resolved at gift time. Core decides whether to use them. */
  groupMembers(ws: WorkspaceId, teamId: string, groupId: string): Promise<readonly MemberId[]>;
  /** The reacted message (S18), or null when it cannot be read. */
  message(teamId: string, channel: string, ts: string): Promise<SlackMessageRef | null>;
  /** Public, private or DM, for channels whose kind the event does not carry (reactions). */
  channelKind(teamId: string, channel: string): Promise<ChannelKind>;
  /** Whole-channel stickers: the channel's members. */
  channelMembers(ws: WorkspaceId, teamId: string, channel: string): Promise<readonly MemberId[]>;
}
