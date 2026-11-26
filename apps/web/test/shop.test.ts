// S2 batch redemption on the web: the stepper's cap, the form field and the refusal texts.
// Core decides; these pin what the web hands it and how it explains a refusal.
import { describe, expect, test } from "vitest";
import { errorMessage } from "../src/lib/format.ts";
import { maxUnits, redeemQuantity } from "../src/server/shop-view.ts";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("S2 web shop quantity", () => {
  test("S2: the stepper caps at what the balance and the stock allow, and never below 1", () => {
    expect(maxUnits(12, 42, null)).toBe(3);
    expect(maxUnits(12, 42, 2)).toBe(2);
    expect(maxUnits(12, 5, null)).toBe(1);
    expect(maxUnits(12, 42, 0)).toBe(1);
  });

  test("S2: the form's quantity reaches the command; a form without one stays a single unit", () => {
    expect(redeemQuantity(form({ quantity: "3" }))).toEqual({ quantity: 3 });
    expect(redeemQuantity(form({}))).toEqual({});
    expect(redeemQuantity(form({ quantity: "two" }))).toEqual({ quantity: Number.NaN });
  });

  test("S2: refusals for a batch read in plain words", () => {
    expect(errorMessage({ code: "out_of_stock", available: 2 })).toBe("Only 2 left. Pick fewer units.");
    expect(errorMessage({ code: "out_of_stock" })).toBe("That reward is out of stock right now.");
    expect(errorMessage({ code: "invalid_quantity" })).toBe("Pick how many to redeem: a whole number, 1 or more.");
    expect(errorMessage({ code: "insufficient_redeemable", cost: 36, redeemable: 30 })).toBe("Not enough redeemable balance: it costs 36, you have 30.");
  });
});

describe("S2 redemption lists", () => {
  test("S2: a batch is named with its quantity; one unit (or an old row) reads as before", async () => {
    const { unitsTitle } = await import("../src/server/shop-view.ts");
    expect(unitsTitle("Mug", 3)).toBe("3 × Mug");
    expect(unitsTitle("Mug", 1)).toBe("Mug");
    expect(unitsTitle("Mug", undefined)).toBe("Mug");
  });
});
