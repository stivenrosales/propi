// S15: hashtags in a gift message become value tags.
import type { ValueId } from "../shared/types.ts";

export interface Value {
  readonly id: ValueId;
  readonly name: string;
  readonly hashtag: string | null; // "#ownership"
  readonly emoji: string | null; // ":muscle:"
}

const norm = (tag: string) => (tag.startsWith("#") ? tag : `#${tag}`).toLowerCase();

/** Values whose hashtag (case-insensitive) or emoji appears in the message, in definition order. */
export function matchValues(hashtags: readonly string[], emojiTokens: readonly string[], values: readonly Value[]): ValueId[] {
  const tags = new Set(hashtags.map(norm));
  const emojis = new Set(emojiTokens);
  return values
    .filter((v) => (v.hashtag !== null && tags.has(norm(v.hashtag))) || (v.emoji !== null && emojis.has(v.emoji)))
    .map((v) => v.id);
}
