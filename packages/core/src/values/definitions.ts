// S41: an admin defines values: a name, an optional hashtag and an optional emoji.
// Value emojis never overlap gift emojis, so a reaction means one thing (architecture §4).
import type { ValueId } from "../shared/types.ts";
import { giftEmojiValues, type Currency } from "../workspace/currency.ts";
import type { Value } from "./values.ts";

export interface ValueInput {
  readonly name: string;
  /** "#ownership" or "ownership"; stored lowercase with the "#". */
  readonly hashtag: string | null;
  /** A shortcode, e.g. ":muscle:". */
  readonly emoji: string | null;
}

export type ValueProblem = "name_required" | "duplicate_name" | "invalid_hashtag" | "duplicate_hashtag" | "duplicate_emoji" | "emoji_is_gift_emoji";

export type ValueDefinition = { readonly ok: true; readonly values: readonly Value[] } | { readonly ok: false; readonly problem: ValueProblem };

const HASHTAG = /^#[\p{L}\p{N}_-]+$/u;

export const normalizeHashtag = (tag: string): string => (tag.trim().startsWith("#") ? tag.trim() : `#${tag.trim()}`).toLowerCase();

/** Adds or replaces (by id) one value; returns the whole new list in definition order. */
export function defineValue(existing: readonly Value[], id: ValueId, input: ValueInput, currency: Currency): ValueDefinition {
  const name = input.name.trim();
  if (name === "") return { ok: false, problem: "name_required" };
  const hashtag = input.hashtag === null || input.hashtag.trim() === "" ? null : normalizeHashtag(input.hashtag);
  if (hashtag !== null && !HASHTAG.test(hashtag)) return { ok: false, problem: "invalid_hashtag" };
  const emoji = input.emoji === null || input.emoji.trim() === "" ? null : input.emoji.trim();
  if (emoji !== null && giftEmojiValues(currency).has(emoji)) return { ok: false, problem: "emoji_is_gift_emoji" };
  const others = existing.filter((v) => v.id !== id);
  if (others.some((v) => v.name.toLowerCase() === name.toLowerCase())) return { ok: false, problem: "duplicate_name" };
  if (hashtag !== null && others.some((v) => v.hashtag !== null && normalizeHashtag(v.hashtag) === hashtag)) return { ok: false, problem: "duplicate_hashtag" };
  if (emoji !== null && others.some((v) => v.emoji === emoji)) return { ok: false, problem: "duplicate_emoji" };
  const value: Value = { id, name, hashtag, emoji };
  const at = existing.findIndex((v) => v.id === id);
  return { ok: true, values: at === -1 ? [...existing, value] : existing.map((v, i) => (i === at ? value : v)) };
}
