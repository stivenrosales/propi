// Local wall-clock time in an IANA zone -> epoch instant, through Intl only (S3, S101).
import type { Instant } from "../shared/types.ts";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Offset of `tz` from UTC at `instant`, in ms (local = utc + offset). */
function offsetAt(instant: number, tz: string): number {
  const parts = formatter(tz).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** "YYYY-MM-DD HH:MM[:SS]" read as wall-clock time in `tz`. */
export function zonedLocalToInstant(local: string, tz: string): Instant {
  const m = LOCAL.exec(local.trim());
  if (!m) throw new Error(`invalid timestamp "${local}": expected YYYY-MM-DD HH:MM:SS`);
  const n = (i: number) => Number(m[i] ?? "0");
  const guess = Date.UTC(n(1), n(2) - 1, n(3), n(4), n(5), n(6));
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  return second as Instant;
}
