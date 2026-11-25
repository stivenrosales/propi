// S3, S80: report periods as local dates in the workspace timezone. Pure date arithmetic on
// "YYYY-MM-DD" strings, so the SQL side can filter with `(at AT TIME ZONE tz)::date BETWEEN from AND to`.
import type { Instant, LocalDate } from "../shared/types.ts";
import { localDate } from "../workspace/time.ts";

export type Timeframe =
  | { readonly kind: "today" }
  | { readonly kind: "week" } // ISO week, Monday first
  | { readonly kind: "month" }
  | { readonly kind: "year" }
  | { readonly kind: "all" }
  | { readonly kind: "custom"; readonly from: LocalDate; readonly to: LocalDate };

/** Inclusive local-date range; null means open on that side. */
export interface DateRange {
  readonly from: LocalDate | null;
  readonly to: LocalDate | null;
}

export const ALL_TIME: DateRange = { from: null, to: null };

const DAY_MS = 86_400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function parse(d: LocalDate): number {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
}
const fmt = (ms: number): LocalDate => new Date(ms).toISOString().slice(0, 10) as LocalDate;

export const addLocalDays = (d: LocalDate, n: number): LocalDate => fmt(parse(d) + n * DAY_MS);

/** 1 = Monday ... 7 = Sunday. */
export function isoWeekday(d: LocalDate): number {
  const w = new Date(parse(d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export const weekStart = (d: LocalDate): LocalDate => addLocalDays(d, 1 - isoWeekday(d));

/** ISO week key, "2026-W48". Used in periodic job keys (`job:nudge:<ws>:<week>`). */
export function isoWeekKey(d: LocalDate): string {
  const thursday = addLocalDays(d, 4 - isoWeekday(d));
  const year = thursday.slice(0, 4);
  const week = Math.floor((parse(thursday) - parse(`${year}-01-01` as LocalDate)) / DAY_MS / 7) + 1;
  return `${year}-W${pad(week)}`;
}

export function lastDayOfMonth(month: string): LocalDate {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return fmt(Date.UTC(y, m, 0));
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

export const monthRange = (month: string): DateRange => ({ from: `${month}-01` as LocalDate, to: lastDayOfMonth(month) });

/** S84: from the first of last month to the same day number (clamped to that month's last day). */
export function sameSpanLastMonth(today: LocalDate): DateRange {
  const prev = previousMonth(today.slice(0, 7));
  const last = lastDayOfMonth(prev);
  const day = Math.min(Number(today.slice(8, 10)), Number(last.slice(8, 10)));
  return { from: `${prev}-01` as LocalDate, to: `${prev}-${pad(day)}` as LocalDate };
}

/** S80: the local-date range a timeframe covers at `now`. */
export function rangeOf(tf: Timeframe, now: Instant, tz: string): DateRange {
  const today = localDate(now, tz);
  switch (tf.kind) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: weekStart(today), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01` as LocalDate, to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01` as LocalDate, to: today };
    case "all":
      return ALL_TIME;
    case "custom":
      return { from: tf.from, to: tf.to };
  }
}

export const inRange = (d: LocalDate, r: DateRange): boolean => (r.from === null || d >= r.from) && (r.to === null || d <= r.to);
