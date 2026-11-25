// When the minute scheduler runs each periodic job (architecture §5). Pure: (now, timezone) in,
// the period key (or null) out. Core decides what each job does; command keys make every run
// exactly-once, so these gates only choose the local hour a job first fires.
import { localDate, type Instant, type LocalDate } from "@propi/app";
import { isoWeekday, isoWeekKey, previousMonth } from "@propi/core/boards";

export interface LocalTime {
  readonly date: LocalDate;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  readonly weekday: number;
  readonly hour: number;
  /** "YYYY-MM". */
  readonly month: string;
  /** Day of month, 1-31. */
  readonly day: number;
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

export function localTime(now: Instant, tz: string): LocalTime {
  let f = hourFormatters.get(tz);
  if (f === undefined) hourFormatters.set(tz, (f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" })));
  const date = localDate(now, tz);
  return { date, weekday: isoWeekday(date), hour: Number(f.format(new Date(now))), month: date.slice(0, 7), day: Number(date.slice(8, 10)) };
}

/** Local hour at or after which daily, weekly and monthly sends go out. */
export const SEND_HOUR = 9;
/** S84, S89: the weekly report and isolation scan go out on Monday morning. */
export const WEEKLY_WEEKDAY = 1;
/** S86: the nudge's weekday is core's (insights settings); it goes out in the afternoon. */
export const NUDGE_HOUR = 15;
/** S34: the nightly ledger check runs after this local hour. */
export const LEDGER_CHECK_HOUR = 2;
/** S90, S91: monthly jobs for the previous month fire during the first days of the month only. */
export const MONTHLY_WINDOW_DAYS = 3;

/** S84, S89: the ISO week key on Monday from SEND_HOUR, else null. */
export const weeklyDue = (t: LocalTime): string | null => (t.weekday === WEEKLY_WEEKDAY && t.hour >= SEND_HOUR ? isoWeekKey(t.date) : null);

/** S86: whether the nudge may go out now (core decides the day and who). */
export const nudgeHourReached = (t: LocalTime): boolean => t.hour >= NUDGE_HOUR;

/** S90, S91: the month just closed, during the first days of the next month from SEND_HOUR. */
export const monthlyDue = (t: LocalTime): string | null => (t.day <= MONTHLY_WINDOW_DAYS && t.hour >= SEND_HOUR ? previousMonth(t.month) : null);

/** S34: once per local date after LEDGER_CHECK_HOUR; `lastRun` is the date it last ran. */
export const ledgerCheckDue = (t: LocalTime, lastRun: LocalDate | null): boolean => t.hour >= LEDGER_CHECK_HOUR && lastRun !== t.date;

/** S58: collab deadlines are checked every this many minutes. */
export const COLLAB_CHECK_EVERY_MS = 15 * 60_000;
