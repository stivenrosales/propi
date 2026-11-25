// Slack events → app commands (S9-S24, S42, S106). Translation only: it resolves Slack ids into
// members, normalizes the text and builds the command with its §1.7 key. Every rule (amounts,
// receivers, allowance, channel policy, edits, reversals) is decided by core through execute().
import {
  giftEmojiValues,
  type Actor,
  type AppCommand,
  type Channel,
  type ChannelKind,
  type CommandKey,
  type DeleteMessage,
  type EditMessage,
  type GiveByMessage,
  type GiveByReaction,
  type InboundMessage,
  type Instant,
  type Mention,
  type RemoveReaction,
  type TagGiftByReaction,
  type WorkspaceId,
} from "@propi/app";
import { emojiToken, parseSlackText, slackKeys } from "./text.ts";
import type { SlackEnvelope, SlackEvent, SlackLookup, SlackMessage, SlackReaction } from "./types.ts";

/** A translated event: the workspace it belongs to and the command to execute, or why there is none. */
export type Translation =
  | { readonly kind: "command"; readonly workspaceId: WorkspaceId; readonly command: AppCommand }
  | { readonly kind: "ignored"; readonly reason: string };

const ignored = (reason: string): Translation => ({ kind: "ignored", reason });
const key = (s: string) => s as CommandKey;

/** Slack's `ts` ("1732550400.000200") as epoch ms. */
export const tsToInstant = (ts: string): Instant => Math.round(Number(ts) * 1000) as Instant;

/** S16: Slack's channel_type → the platform-neutral channel kind. Group DMs are DMs. */
export function channelKindOf(channelType: SlackMessage["channel_type"]): ChannelKind | null {
  switch (channelType) {
    case "channel":
      return "public";
    case "group":
      return "private";
    case "im":
    case "mpim":
      return "dm";
    default:
      return null;
  }
}

/** Subtypes that are a person's (or bot's) message; anything else (joins, topics, …) is not. */
const MESSAGE_SUBTYPES = new Set([undefined, "thread_broadcast", "file_share", "bot_message", "me_message"]);

async function actorOf(lookup: SlackLookup, ws: WorkspaceId, team: string, m: { readonly user?: string; readonly bot_id?: string }): Promise<Actor | null> {
  if (m.user === undefined && m.bot_id !== undefined) return { kind: "bot", platformUserId: m.bot_id }; // S8
  if (m.user === undefined) return null;
  return lookup.actor(ws, team, m.user);
}

async function mentionsOf(lookup: SlackLookup, ws: WorkspaceId, team: string, userIds: readonly string[], groupIds: readonly string[]): Promise<Mention[]> {
  const out: Mention[] = [];
  for (const id of userIds) {
    const mn = await lookup.mention(ws, team, id);
    if (mn !== null) out.push(mn);
  }
  for (const groupId of groupIds) out.push({ kind: "group", groupId, memberIds: await lookup.groupMembers(ws, team, groupId) });
  return out;
}

/** The InboundMessage for a Slack text (S9, S12, S15). */
export async function inboundMessage(lookup: SlackLookup, ws: WorkspaceId, team: string, channel: Channel, text: string): Promise<InboundMessage> {
  const p = parseSlackText(text);
  return { channel, text, mentions: await mentionsOf(lookup, ws, team, p.userIds, p.groupIds), emojiTokens: p.emojis, hashtags: p.hashtags };
}

async function translateMessage(lookup: SlackLookup, ws: WorkspaceId, team: string, ev: SlackMessage): Promise<Translation> {
  const kind = channelKindOf(ev.channel_type) ?? (await lookup.channelKind(team, ev.channel));
  const channel: Channel = { id: ev.channel, kind };

  if (ev.subtype === "message_changed") {
    const next = ev.message;
    // Unfurls and other attachments also send message_changed; only a real text edit counts (S23).
    if (next === undefined || next.edited === undefined || next.text === ev.previous_message?.text) return ignored("not_an_edit");
    const actor = await actorOf(lookup, ws, team, next);
    if (actor === null) return ignored("unknown_author");
    const cmd: EditMessage = {
      type: "EditMessage",
      key: key(slackKeys.edit(team, ev.channel, next.ts, next.edited.ts)),
      workspaceId: ws,
      actor,
      at: tsToInstant(next.edited.ts),
      messageRef: slackKeys.messageRef(team, ev.channel, next.ts),
      message: await inboundMessage(lookup, ws, team, channel, next.text ?? ""),
    };
    return { kind: "command", workspaceId: ws, command: cmd };
  }

  if (ev.subtype === "message_deleted") {
    const prev = ev.previous_message;
    const ts = ev.deleted_ts ?? prev?.ts;
    if (prev === undefined || ts === undefined) return ignored("no_previous_message");
    const actor = await actorOf(lookup, ws, team, prev);
    if (actor === null) return ignored("unknown_author");
    const cmd: DeleteMessage = {
      type: "DeleteMessage",
      key: key(slackKeys.del(team, ev.channel, ts)),
      workspaceId: ws,
      actor,
      at: tsToInstant(ev.ts),
      messageRef: slackKeys.messageRef(team, ev.channel, ts),
    };
    return { kind: "command", workspaceId: ws, command: cmd };
  }

  if (!MESSAGE_SUBTYPES.has(ev.subtype)) return ignored(`subtype_${ev.subtype}`);
  const text = ev.text ?? "";
  // Cheap pre-filter: a message with no emoji at all can never be a gift (S9); skip the lookups.
  if (!/:[a-z0-9_+'-]+:/i.test(text)) return ignored("no_emoji");
  const actor = await actorOf(lookup, ws, team, ev);
  if (actor === null) return ignored("unknown_author");
  const cmd: GiveByMessage = {
    type: "GiveByMessage",
    key: key(slackKeys.message(team, ev.channel, ev.ts)),
    workspaceId: ws,
    actor,
    at: tsToInstant(ev.ts),
    messageRef: slackKeys.messageRef(team, ev.channel, ev.ts),
    message: await inboundMessage(lookup, ws, team, channel, text),
  };
  return { kind: "command", workspaceId: ws, command: cmd };
}

async function translateReaction(lookup: SlackLookup, ws: WorkspaceId, team: string, ev: SlackReaction): Promise<Translation> {
  const { channel, ts } = ev.item;
  if (ev.item.type !== "message" || channel === undefined || ts === undefined) return ignored("not_a_message");
  const emoji = emojiToken(ev.reaction);
  const name = emoji.slice(1, -1);
  const settings = await lookup.settings(ws);
  const isGiftEmoji = giftEmojiValues(settings.currency).has(emoji);
  const isValueEmoji = !isGiftEmoji && (await lookup.values(ws)).some((v) => v.emoji === emoji);
  if (!isGiftEmoji && !isValueEmoji) return ignored("not_a_gift_emoji");

  const actor = await lookup.actor(ws, team, ev.user);
  if (actor === null) return ignored("unknown_reactor");
  const messageRef = slackKeys.messageRef(team, channel, ts);
  const base = { workspaceId: ws, actor, at: tsToInstant(ev.event_ts), messageRef, emoji };

  if (isValueEmoji) {
    if (ev.type === "reaction_removed") return ignored("value_tag_removal");
    const cmd: TagGiftByReaction = { type: "TagGiftByReaction", key: key(slackKeys.tag(team, channel, ts, ev.user, name)), ...base };
    return { kind: "command", workspaceId: ws, command: cmd };
  }

  if (ev.type === "reaction_removed") {
    const cmd: RemoveReaction = { type: "RemoveReaction", key: key(slackKeys.unreact(team, channel, ts, ev.user, name)), ...base };
    return { kind: "command", workspaceId: ws, command: cmd };
  }
  if (!settings.reactionsEnabled) return ignored("reactions_disabled"); // S18 (core re-checks)

  const target = await lookup.message(team, channel, ts);
  if (target === null) return ignored("message_unreadable");
  const p = parseSlackText(target.text);
  const author = target.user === null ? null : await lookup.mention(ws, team, target.user);
  const cmd: GiveByReaction = {
    type: "GiveByReaction",
    key: key(slackKeys.react(team, channel, ts, ev.user, name)),
    ...base,
    channel: { id: channel, kind: await lookup.channelKind(team, channel) },
    target: {
      author: author?.kind === "member" ? author.memberId : null,
      mentions: await mentionsOf(lookup, ws, team, p.userIds, p.groupIds),
    },
  };
  return { kind: "command", workspaceId: ws, command: cmd };
}

/** One Events API envelope → at most one command. Lifecycle events are handled by the server. */
export async function translateEvent(lookup: SlackLookup, body: SlackEnvelope): Promise<Translation> {
  const ws = await lookup.workspace(body.team_id);
  if (ws === null) return ignored("unknown_workspace");
  const ev: SlackEvent = body.event;
  if (ev.type === "message") return translateMessage(lookup, ws, body.team_id, ev as SlackMessage);
  if (ev.type === "reaction_added" || ev.type === "reaction_removed") return translateReaction(lookup, ws, body.team_id, ev as SlackReaction);
  return ignored(`event_${ev.type}`);
}
