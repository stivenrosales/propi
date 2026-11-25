// S3, S61, S75, S95: calendar periods in the workspace timezone. Pure: Intl only, no clock.
import type { Instant, LocalDate } from "../shared/types.ts";
import { zonedLocalToInstant } from "../migration/zoned.ts";
import { localDate } from "../workspace/time.ts";

export type RulePeriodKind = "week" | "month" | "quarter";

const DAY = 86_400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Days since 1970-01-01 for a calendar date (no timezone involved). */
export function dayNumber(date: LocalDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

export function dateOfDay(n: number): LocalDate {
  const d = new Date(n * DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` as LocalDate;
}

export const addDays = (date: LocalDate, days: number): LocalDate => dateOfDay(dayNumber(date) + days);

/** Monday = 0 … Sunday = 6. */
const weekday = (n: number) => (((n + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday

/** The Monday of the week containing `date`. */
export const mondayOf = (date: LocalDate): LocalDate => {
  const n = dayNumber(date);
  return dateOfDay(n - weekday(n));
};

/** ISO 8601 week id, e.g. "2026-W48". */
export function isoWeekId(date: LocalDate): string {
  const n = dayNumber(date);
  const thursday = n - weekday(n) + 3;
  const year = Number(dateOfDay(thursday).slice(0, 4));
  const week = Math.floor((thursday - dayNumber(`${year}-01-01` as LocalDate)) / 7) + 1;
  return `${year}-W${pad(week)}`;
}

/** The Monday that starts ISO week 1 of `year`. */
function isoYearStart(year: number): number {
  const jan4 = dayNumber(`${year}-01-04` as LocalDate);
  return jan4 - weekday(jan4);
}

const PATTERNS: Readonly<Record<RulePeriodKind, RegExp>> = {
  week: /^(\d{4})-W(\d{2})$/,
  month: /^(\d{4})-(\d{2})$/,
  quarter: /^(\d{4})-Q([1-4])$/,
};

/** The first local date of a period, or null if the id is malformed for its kind. */
export function rulePeriodStart(kind: RulePeriodKind, id: string): LocalDate | null {
  const m = PATTERNS[kind].exec(id);
  if (!m) return null;
  const year = Number(m[1]);
  const n = Number(m[2]);
  switch (kind) {
    case "week": {
      if (n < 1 || n > 53) return null;
      const start = isoYearStart(year) + (n - 1) * 7;
      return isoWeekId(dateOfDay(start)) === id ? dateOfDay(start) : null;
    }
    case "month":
      return n >= 1 && n <= 12 ? (`${year}-${pad(n)}-01` as LocalDate) : null;
    case "quarter":
      return `${year}-${pad((n - 1) * 3 + 1)}-01` as LocalDate;
  }
}

/** The period containing a local date. */
export function rulePeriodOfDate(kind: RulePeriodKind, date: LocalDate): string {
  switch (kind) {
    case "week":
      return isoWeekId(date);
    case "month":
      return date.slice(0, 7);
    case "quarter":
      return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  }
}

/** The period containing `instant` in `tz` (S3). */
export const rulePeriodOf = (kind: RulePeriodKind, instant: Instant, tz: string): string => rulePeriodOfDate(kind, localDate(instant, tz));

function nextStart(kind: RulePeriodKind, start: LocalDate): LocalDate {
  if (kind === "week") return addDays(start, 7);
  const [y, m] = start.split("-").map(Number) as [number, number];
  const months = kind === "month" ? 1 : 3;
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01` as LocalDate;
}

export const nextRulePeriod = (kind: RulePeriodKind, id: string): string | null => {
  const s = rulePeriodStart(kind, id);
  return s === null ? null : rulePeriodOfDate(kind, nextStart(kind, s));
};

export const previousRulePeriod = (kind: RulePeriodKind, id: string): string | null => {
  const s = rulePeriodStart(kind, id);
  return s === null ? null : rulePeriodOfDate(kind, addDays(s, -1));
};

/** Local midnight of `date` in `tz` as an instant. */
export const startOfLocalDay = (date: LocalDate, tz: string): Instant => zonedLocalToInstant(`${date} 00:00`, tz);

export interface RulePeriodRange {
  readonly start: Instant; // inclusive
  readonly end: Instant; // exclusive: the period closes here (S61)
}

/** [start, end) of a period in `tz`, or null if the id is malformed. */
export function rulePeriodRange(kind: RulePeriodKind, id: string, tz: string): RulePeriodRange | null {
  const s = rulePeriodStart(kind, id);
  if (s === null) return null;
  return { start: startOfLocalDay(s, tz), end: startOfLocalDay(nextStart(kind, s), tz) };
}

/** The most recent period that has fully closed at `now` (S61). */
export const lastClosedRulePeriod = (kind: RulePeriodKind, now: Instant, tz: string): string =>
  previousRulePeriod(kind, rulePeriodOf(kind, now, tz)) as string;
