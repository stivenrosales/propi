// Notification planning for the outbox relay and the scheduler (S29, S83-S86).
// Plans are data; the relay delivers them. Job keys make periodic runs exactly-once.
import type { DomainEvent, GiftId, WorkspaceId } from "@propi/core";
import { nudgePlan, planEventNotifications, weeklyReportPlan, type Notification } from "@propi/core/notify";
import { isoWeekKey } from "@propi/core/boards";
import { localDate } from "@propi/core";
import { loadBoardData, type InsightsDeps } from "../boards/load.ts";

export interface PeriodicPlan<N> {
  /** The command key the scheduler runs this job under (`job:<name>:<ws>:<period>`). */
  readonly key: string;
  readonly notifications: readonly N[];
}

export interface NotifyQueries {
  /** S29, S83, S85: notifications for one outbox event. */
  eventNotifications(ws: WorkspaceId, event: DomainEvent): Promise<Notification[]>;
  /** S84, S85: this week's reports. */
  weeklyReports(ws: WorkspaceId): Promise<PeriodicPlan<Extract<Notification, { type: "weekly_report" }>>>;
  /** S86: null unless today is the workspace's nudge day and the nudge is on. */
  nudges(ws: WorkspaceId): Promise<PeriodicPlan<Extract<Notification, { type: "nudge" }>> | null>;
}

const giftIdOf = (e: DomainEvent): GiftId | null => ("giftId" in e && typeof e.giftId === "string" ? (e.giftId as GiftId) : null);

export function notifyQueries(d: InsightsDeps): NotifyQueries {
  const now = () => d.ports.clock.now();
  return {
    async eventNotifications(ws, event) {
      const giftId = giftIdOf(event);
      const [gift, members, preferences] = await Promise.all([
        giftId === null ? null : d.ports.reader.workspace(ws).gift(giftId),
        d.ports.directory.members(ws),
        d.source.preferences(ws),
      ]);
      return planEventNotifications(event, { gift, preferences, members: new Set(members.map((r) => r.id)) });
    },
    async weeklyReports(ws) {
      const [data, preferences] = await Promise.all([loadBoardData(d, ws), d.source.preferences(ws)]);
      const week = isoWeekKey(localDate(now(), data.workspace.timezone));
      return { key: `job:report:${ws}:${week}`, notifications: weeklyReportPlan(data, preferences, now()) };
    },
    async nudges(ws) {
      const [data, preferences] = await Promise.all([loadBoardData(d, ws), d.source.preferences(ws)]);
      const plan = nudgePlan(data, preferences, now());
      return plan === null ? null : { key: `job:nudge:${ws}:${plan.week}`, notifications: plan.notifications };
    },
  };
}
