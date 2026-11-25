// Periodic notification plans (weekly report S84, nudge S86, isolation S89, reciprocity S90,
// digest S91) become outbox events through one command, so they are exactly-once by their job key
// (`job:<name>:<ws>:<period>`, architecture §5) and at-least-once to Slack through the relay.
// Core computes every plan; this handler only persists it. It writes no ledger entries.
import { accept, defineHandler, type CommandBase, type DomainEvent, type MemberId } from "@propi/app";
import type { Notification } from "@propi/core/notify";
import type { DigestTheme } from "@propi/core/insights";

/** Notifications beyond core's Notification union: admin-only reviews that core plans as data. */
export type ServerNotification =
  | Notification
  | { readonly type: "reciprocity_review"; readonly to: MemberId; readonly period: string; readonly pairs: readonly { readonly a: MemberId; readonly b: MemberId }[] }
  | { readonly type: "monthly_digest"; readonly to: MemberId; readonly month: string; readonly team: readonly DigestTheme[] };

export interface RecordNotifications extends CommandBase {
  readonly type: "RecordNotifications";
  readonly notifications: readonly ServerNotification[];
}

/** The outbox event each notification becomes. Not in the webhook catalog, so it stays internal. */
export interface NotifyEvent {
  readonly type: "notify";
  readonly notification: ServerNotification;
}

export const NOTIFY_EVENT = "notify";

export const jobHandlers = [
  defineHandler<RecordNotifications, object, { readonly count: number }>({
    type: "RecordNotifications",
    locks: () => [],
    load: async () => ({}),
    decide: (_s, cmd) =>
      accept(
        { count: cmd.notifications.length },
        { events: cmd.notifications.map((notification) => ({ type: NOTIFY_EVENT, notification }) as unknown as DomainEvent) },
      ),
  }),
];
