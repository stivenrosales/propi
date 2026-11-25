// S86: the weekly recognition nudge for members with unused allowance this week.
import { dailyLimit } from "../giving/allowance.ts";
import { allowanceUsed } from "../ledger/replay.ts";
import type { Instant, LocalDate, MemberId } from "../shared/types.ts";
import { localDate } from "../workspace/time.ts";
import { addLocalDays, isoWeekday, isoWeekKey, weekStart } from "../boards/periods.ts";
import type { BoardData } from "../boards/source.ts";
import type { Notification } from "./plan.ts";
import { wants, type NotificationPreferences } from "./preferences.ts";

/** The week key (`job:nudge:<ws>:<week>`) when today is the workspace's nudge weekday; else null. */
export function nudgeDue(now: Instant, data: Pick<BoardData, "workspace" | "insights">): string | null {
  const { enabled, weekday } = data.insights.nudge;
  const today = localDate(now, data.workspace.timezone);
  return enabled && isoWeekday(today) === weekday ? isoWeekKey(today) : null;
}

export interface NudgePlan {
  readonly week: string;
  readonly notifications: readonly Extract<Notification, { type: "nudge" }>[];
}

/** Unused = the daily limits of the week's days so far minus what was used each day (never below 0 per day). */
export function nudgePlan(data: BoardData, preferences: ReadonlyMap<MemberId, NotificationPreferences>, now: Instant): NudgePlan | null {
  const week = nudgeDue(now, data);
  if (week === null) return null;
  const today = localDate(now, data.workspace.timezone);
  const days: LocalDate[] = [];
  for (let d = weekStart(today); d <= today; d = addLocalDays(d, 1)) days.push(d);
  const notifications: Extract<Notification, { type: "nudge" }>[] = [];
  for (const r of [...data.members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!r.active || !wants(preferences.get(r.id), "nudge")) continue;
    const limit = dailyLimit(r, data.workspace);
    let unused = 0;
    for (const d of days) unused += Math.max(0, limit - allowanceUsed(data.entries, r.id, d));
    if (unused > 0) notifications.push({ type: "nudge", to: r.id, week, unused });
  }
  return { week, notifications };
}
