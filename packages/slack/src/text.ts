// Slack message text → the pieces an InboundMessage needs (S9, S12, S15). Pure parsing, no rules:
// which emojis count, who receives and which values match are decided by core.

export interface ParsedText {
  /** `<@U…>` user mentions, in order, deduplicated. */
  readonly userIds: readonly string[];
  /** `<!subteam^S…>` user-group mentions, in order, deduplicated. */
  readonly groupIds: readonly string[];
  /** Emoji shortcodes in order, with colons (":taco:"); skin tones are dropped. */
  readonly emojis: readonly string[];
  /** Hashtags with their "#", outside of Slack links (`<#C…|general>` is a channel, not a tag). */
  readonly hashtags: readonly string[];
}

const USER = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;
const GROUP = /<!subteam\^([A-Z0-9]+)(?:\|[^>]*)?>/g;
const ANGLE = /<[^>]*>/g;
const EMOJI = /:([a-z0-9_+'-]+):(?::skin-tone-[2-6]:)?/gi;
const HASHTAG = /(?:^|[\s(])(#[\p{L}\p{N}_-]+)/gu;

const unique = (xs: Iterable<string>): string[] => [...new Set(xs)];

/** Slack's reaction name ("taco", "thumbsup::skin-tone-2") as a shortcode token (":taco:"). */
export function emojiToken(name: string): string {
  const base = name.replace(/::skin-tone-[2-6]$/, "").replace(/^:|:$/g, "");
  return `:${base}:`;
}

export function parseSlackText(text: string): ParsedText {
  const userIds = unique([...text.matchAll(USER)].map((m) => m[1]!));
  const groupIds = unique([...text.matchAll(GROUP)].map((m) => m[1]!));
  const plain = text.replace(ANGLE, " ");
  const emojis = [...plain.matchAll(EMOJI)].map((m) => `:${m[1]!}:`);
  const hashtags = unique([...plain.matchAll(HASHTAG)].map((m) => m[1]!));
  return { userIds, groupIds, emojis, hashtags };
}

/** Command keys, exactly as architecture §1.7 (G8 appends the occurrence in the app). */
export const slackKeys = {
  messageRef: (team: string, channel: string, ts: string) => `${team}:${channel}:${ts}`,
  message: (team: string, channel: string, ts: string) => `slack:msg:${team}:${channel}:${ts}`,
  edit: (team: string, channel: string, ts: string, editTs: string) => `slack:edit:${team}:${channel}:${ts}:${editTs}`,
  del: (team: string, channel: string, ts: string) => `slack:del:${team}:${channel}:${ts}`,
  react: (team: string, channel: string, ts: string, user: string, emoji: string) => `slack:react:${team}:${channel}:${ts}:${user}:${emoji}`,
  unreact: (team: string, channel: string, ts: string, user: string, emoji: string) => `slack:unreact:${team}:${channel}:${ts}:${user}:${emoji}`,
  /** A value tag by reaction is a separate command on the same message. */
  tag: (team: string, channel: string, ts: string, user: string, emoji: string) => `slack:tag:${team}:${channel}:${ts}:${user}:${emoji}`,
  /** Interactions carry Slack's own unique trigger or action timestamp, so a Slack retry dedupes. */
  sticker: (team: string, user: string, triggerId: string) => `slack:sticker:${team}:${user}:${triggerId}`,
  redeem: (team: string, user: string, actionTs: string) => `slack:redeem:${team}:${user}:${actionTs}`,
  review: (team: string, user: string, kind: "redemption" | "submission", id: string, verdict: string) => `slack:review:${team}:${user}:${kind}:${id}:${verdict}`,
} as const;
