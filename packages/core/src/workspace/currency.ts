// S1, S2: the workspace currency. Domain code never hard-codes names or emojis.
import type { DomainError, PosInt } from "../shared/types.ts";
import { isPosInt } from "../shared/types.ts";

export interface Currency {
  readonly primaryEmoji: string; // ":taco:"
  readonly singular: string;
  readonly plural: string;
  /** Extra gift emojis with a fixed integer value >= 1, e.g. ":fire:" -> 3 (S2). */
  readonly extraEmojis: ReadonlyMap<string, PosInt>;
}

export function validateCurrency(c: Currency): Extract<DomainError, { code: "invalid_currency" }> | null {
  if (c.primaryEmoji.trim() === "") return { code: "invalid_currency", field: "primaryEmoji" };
  if (c.singular.trim() === "") return { code: "invalid_currency", field: "singular" };
  if (c.plural.trim() === "") return { code: "invalid_currency", field: "plural" };
  for (const v of c.extraEmojis.values()) if (!isPosInt(v)) return { code: "invalid_currency", field: "extraEmojis" };
  return null;
}

/** Every recognized gift emoji with its value; the primary emoji is worth 1. */
export function giftEmojiValues(c: Currency): ReadonlyMap<string, number> {
  const out = new Map<string, number>([[c.primaryEmoji, 1]]);
  for (const [emoji, value] of c.extraEmojis) out.set(emoji, value);
  return out;
}

/** Sum of the values of the recognized emojis among `tokens` (S2, S9). */
export function amountOf(tokens: readonly string[], c: Currency): number {
  const values = giftEmojiValues(c);
  let total = 0;
  for (const t of tokens) total += values.get(t) ?? 0;
  return total;
}

/** "1 taco", "3 tacos" — from the workspace names (S1). */
export function formatUnits(c: Currency, n: number): string {
  return `${n} ${Math.abs(n) === 1 ? c.singular : c.plural}`;
}
