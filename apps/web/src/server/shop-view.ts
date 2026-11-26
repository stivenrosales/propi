// S2 batch redemption: the web shop's view of how many units a member may pick. The stepper only
// guides; core's Redeem decider stays the source of truth (stock, balance, budget, plan limit).
// Framework-free so it is unit-tested (like settings-form.ts).

/** The most units the stepper offers: what the balance and the stock (null = unlimited) allow; at least 1. */
export function maxUnits(cost: number, redeemable: number, stock: number | null): number {
  const byBalance = Math.floor(redeemable / cost);
  return Math.max(1, Math.min(byBalance, stock ?? byBalance));
}

/** The form's `quantity` for the Redeem command; a form without one sends none (one unit, as before). */
export function redeemQuantity(form: FormData): { quantity?: number } {
  const v = String(form.get("quantity") ?? "").trim();
  if (v === "") return {};
  // Same rule as command.ts int(): a non-integer becomes NaN and core refuses it (invalid_quantity).
  return { quantity: /^-?\d+$/.test(v) ? Number(v) : Number.NaN };
}

/** S2: how a redemption names what was redeemed: "Mug" for one unit, "3 × Mug" for a batch. */
export const unitsTitle = (title: string, quantity: number | undefined): string => (quantity === undefined || quantity === 1 ? title : `${quantity} × ${title}`);
