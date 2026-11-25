// S89: alert admins when an active member has received nothing for N weeks (default 3).
import type { Instant, MemberId } from "../shared/types.ts";
import { localDate } from "../workspace/time.ts";
import { addTo, cmp, giftLines } from "../boards/facts.ts";
import { filterLines } from "../boards/leaderboard.ts";
import { addLocalDays, isoWeekKey } from "../boards/periods.ts";
import type { BoardData } from "../boards/source.ts";
import type { Notification } from "../notify/plan.ts";
import { wants, type NotificationPreferences } from "../notify/preferences.ts";

/** Active members whose net units received over the last `weeks` x 7 local days (today included) are <= 0. */
export function isolatedMembers(data: BoardData, now: Instant, weeks: number = data.insights.isolationWeeks): MemberId[] {
  const today = localDate(now, data.workspace.timezone);
  const range = { from: addLocalDays(today, 1 - 7 * weeks), to: today };
  const received = new Map<MemberId, number>();
  for (const l of filterLines(giftLines(data), { range })) addTo(received, l.receiver, l.units);
  return data.members
    .filter((r) => r.active && (received.get(r.id) ?? 0) <= 0)
    .map((r) => r.id)
    .sort(cmp);
}

export interface IsolationAlertPlan {
  /** For the job key `job:isolation:<ws>:<week>`. */
  readonly week: string;
  readonly isolated: readonly MemberId[];
  readonly notifications: readonly Extract<Notification, { type: "isolation_alert" }>[];
}

/** Admins who keep isolation alerts on get one alert listing everyone isolated. */
export function isolationAlertPlan(data: BoardData, preferences: ReadonlyMap<MemberId, NotificationPreferences>, now: Instant): IsolationAlertPlan {
  const weeks = data.insights.isolationWeeks;
  const isolated = isolatedMembers(data, now, weeks);
  const admins = data.members.filter((r) => r.active && r.role === "admin" && wants(preferences.get(r.id), "isolation_alert")).map((r) => r.id).sort(cmp);
  return {
    week: isoWeekKey(localDate(now, data.workspace.timezone)),
    isolated,
    notifications: isolated.length === 0 ? [] : admins.map((to) => ({ type: "isolation_alert", to, isolated, weeks }) as const),
  };
}
