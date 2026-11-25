// S88: admin team metrics per period.
import type { EntryKind } from "../ledger/entries.ts";
import { signedAmount } from "../ledger/entries.ts";
import type { Actor, MemberId, ValueId } from "../shared/types.ts";
import { localDate } from "../workspace/time.ts";
import { addTo, cmp, giftLines, percent, ratio } from "../boards/facts.ts";
import { filterLines } from "../boards/leaderboard.ts";
import { inRange, type DateRange } from "../boards/periods.ts";
import type { BoardData } from "../boards/source.ts";

/** Money budget for the period, owned by the shop module (S47); integer cents (G10). */
export interface BudgetUse {
  readonly usedCents: number;
  readonly limitCents: number;
}

export interface TeamMetrics {
  readonly range: DateRange;
  readonly activeMembers: number;
  /** Gifts with net units > 0 in the range. */
  readonly gifts: number;
  /** Net gift units in the range. */
  readonly units: number;
  readonly giftsPerCapita: number;
  readonly unitsPerCapita: number;
  /** % of active members who gave at least one unit (net). */
  readonly giversPercent: number;
  /** % of gifts tagged with at least one value. */
  readonly valueTaggedPercent: number;
  readonly topValues: readonly { readonly valueId: ValueId; readonly gifts: number }[];
  readonly economy: {
    /** Units credited to redeemable: gifts net of reversals, bonuses, rule awards, quest rewards. */
    readonly earned: number;
    /** Spends net of refunds. */
    readonly spent: number;
    readonly deducted: number;
    /** Everyone's redeemable at the end of the range. */
    readonly outstanding: number;
    readonly budget: BudgetUse | null;
  };
}

const EARN: ReadonlySet<EntryKind> = new Set(["gift", "gift_reversal", "bonus", "rule_award", "quest_reward"]);
const SPEND: ReadonlySet<EntryKind> = new Set(["spend", "refund"]);

export function adminMetrics(data: BoardData, range: DateRange, budget: BudgetUse | null, opts: { readonly topValues?: number } = {}): TeamMetrics {
  const active = new Set(data.members.filter((r) => r.active).map((r) => r.id));
  const lines = filterLines(giftLines(data), { range });

  const perGift = new Map<string, { units: number; valueIds: readonly ValueId[] }>();
  const givers = new Map<MemberId, number>();
  for (const l of lines) {
    const row = perGift.get(l.giftKey) ?? { units: 0, valueIds: l.valueIds };
    row.units += l.units;
    perGift.set(l.giftKey, row);
    if (l.giver !== null) addTo(givers, l.giver, l.units);
  }
  const gifts = [...perGift.values()].filter((g) => g.units > 0);
  const tagged = gifts.filter((g) => g.valueIds.length > 0);
  const valueCounts = new Map<ValueId, number>();
  for (const g of tagged) for (const v of g.valueIds) addTo(valueCounts, v, 1);
  const units = lines.reduce((t, l) => t + l.units, 0);
  const giversCount = [...givers].filter(([id, n]) => n > 0 && active.has(id)).length;

  let earned = 0;
  let spent = 0;
  let deducted = 0;
  let outstanding = 0;
  const tz = data.workspace.timezone;
  for (const e of data.entries) {
    const day = localDate(e.at, tz);
    if (range.to === null || day <= range.to) outstanding += signedAmount(e);
    if (!inRange(day, range)) continue;
    if (EARN.has(e.kind)) earned += signedAmount(e);
    else if (SPEND.has(e.kind)) spent -= signedAmount(e);
    else if (e.kind === "deduction") deducted += e.amount;
  }

  return {
    range,
    activeMembers: active.size,
    gifts: gifts.length,
    units,
    giftsPerCapita: ratio(gifts.length, active.size),
    unitsPerCapita: ratio(units, active.size),
    giversPercent: percent(giversCount, active.size),
    valueTaggedPercent: percent(tagged.length, gifts.length),
    topValues: [...valueCounts]
      .map(([valueId, n]) => ({ valueId, gifts: n }))
      .sort((a, b) => b.gifts - a.gifts || cmp(a.valueId, b.valueId))
      .slice(0, opts.topValues ?? 5),
    economy: { earned, spent, deducted, outstanding, budget },
  };
}

/** S88-S90: team insights are for admins and system jobs. */
export function canSeeInsights(actor: Actor | null): boolean {
  return actor !== null && ((actor.kind === "member" && actor.role === "admin") || actor.kind === "system");
}
