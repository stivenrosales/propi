// S3: period math in the workspace timezone, through Intl only.
import type { Instant, LocalDate } from "../shared/types.ts";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimezone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** The calendar date of `instant` in `tz`, "YYYY-MM-DD". */
export function localDate(instant: Instant, tz: string): LocalDate {
  const parts = formatter(tz).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}` as LocalDate;
}

/** The calendar month of `instant` in `tz`, "YYYY-MM". */
export function localMonth(instant: Instant, tz: string): string {
  return localDate(instant, tz).slice(0, 7);
}
