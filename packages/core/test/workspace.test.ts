import { describe, expect, test } from "vitest";
import {
  amountOf,
  formatUnits,
  giftEmojiValues,
  isValidTimezone,
  localDate,
  localMonth,
  validateCurrency,
  type PosInt,
} from "../src/index.ts";
import { at, settings } from "./fixtures.ts";

describe("workspace currency", () => {
  test("S1: user-facing amounts use the workspace currency names, never hard-coded ones", () => {
    const beans = { primaryEmoji: ":coffee:", singular: "bean", plural: "beans", extraEmojis: new Map() };
    expect(formatUnits(beans, 1)).toBe("1 bean");
    expect(formatUnits(beans, 3)).toBe("3 beans");
    expect(formatUnits(settings().currency, 2)).toBe("2 tacos");
  });

  test("S1: a currency needs a primary emoji, a singular and a plural name", () => {
    expect(validateCurrency({ primaryEmoji: ":taco:", singular: "taco", plural: "tacos", extraEmojis: new Map() })).toBeNull();
    expect(validateCurrency({ primaryEmoji: "", singular: "taco", plural: "tacos", extraEmojis: new Map() })).toEqual({
      code: "invalid_currency",
      field: "primaryEmoji",
    });
    expect(validateCurrency({ primaryEmoji: ":taco:", singular: " ", plural: "tacos", extraEmojis: new Map() })).toEqual({
      code: "invalid_currency",
      field: "singular",
    });
  });

  test("S2: extra gift emojis carry a fixed integer value >= 1 and amounts sum the recognized emojis", () => {
    const currency = { ...settings().currency, extraEmojis: new Map([[":fire:", 3 as PosInt]]) };
    expect(giftEmojiValues(currency)).toEqual(new Map([[":taco:", 1], [":fire:", 3]]));
    expect(amountOf([":taco:", ":fire:", ":smile:", ":taco:"], currency)).toBe(5);
    expect(amountOf([":smile:"], currency)).toBe(0);
    expect(validateCurrency({ ...currency, extraEmojis: new Map([[":fire:", 0 as PosInt]]) })).toEqual({
      code: "invalid_currency",
      field: "extraEmojis",
    });
    expect(validateCurrency({ ...currency, extraEmojis: new Map([[":fire:", 1.5 as PosInt]]) })).toEqual({
      code: "invalid_currency",
      field: "extraEmojis",
    });
  });
});

describe("workspace timezone", () => {
  test("S3: day and month boundaries use the workspace timezone", () => {
    // 2026-12-01T03:00Z is still 2026-11-30 22:00 in Lima.
    const instant = at("2026-12-01T03:00:00Z");
    expect(localDate(instant, "America/Lima")).toBe("2026-11-30");
    expect(localDate(instant, "UTC")).toBe("2026-12-01");
    expect(localMonth(instant, "America/Lima")).toBe("2026-11");
    expect(localMonth(instant, "Asia/Tokyo")).toBe("2026-12");
    expect(isValidTimezone("America/Lima")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });
});
