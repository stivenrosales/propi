// S29, S83, S85: domain event -> who gets which private notification. The outbox relay delivers;
// this only decides. Events of other modules plan nothing here.
import type { Gift } from "../giving/types.ts";
import type { AdjustmentKind } from "../ledger/commands.ts";
import type { DomainEvent } from "../shared/decision.ts";
import type { DomainError, GiftId, Instant, MemberId } from "../shared/types.ts";
import type { WeeklyReport } from "../boards/weekly-report.ts";
import { weeklyReport } from "../boards/weekly-report.ts";
import type { BoardData } from "../boards/source.ts";
import { wants, type NotificationPreferences } from "./preferences.ts";

export type Notification =
  | { readonly type: "gift_received"; readonly to: MemberId; readonly giftId: GiftId; readonly giver: MemberId; readonly amount: number; readonly channelId: string | null; readonly text: string | null } // S83
  | { readonly type: "gift_confirmation"; readonly to: MemberId; readonly giftId: GiftId; readonly totalCost: number; readonly remainingAllowance: number | null } // S29
  | { readonly type: "gift_rejected"; readonly to: MemberId; readonly error: DomainError } // S13
  | { readonly type: "adjustment"; readonly to: MemberId; readonly kind: AdjustmentKind; readonly amount: number; readonly reason: string }
  | { readonly type: "weekly_report"; readonly to: MemberId; readonly report: WeeklyReport } // S84
  | { readonly type: "nudge"; readonly to: MemberId; readonly week: string; readonly unused: number } // S86
  | { readonly type: "isolation_alert"; readonly to: MemberId; readonly isolated: readonly MemberId[]; readonly weeks: number }; // S89

export interface PlanContext {
  /** The gift header of a gift event (channel and text for S83), if any. */
  readonly gift: Gift | null;
  readonly preferences: ReadonlyMap<MemberId, NotificationPreferences>;
  /** Workspace members; non-members (bots) never get a DM. */
  readonly members: ReadonlySet<MemberId>;
}

export function planEventNotifications(event: DomainEvent, ctx: PlanContext): Notification[] {
  const out: Notification[] = [];
  const add = (n: Notification) => {
    if (ctx.members.has(n.to) && wants(ctx.preferences.get(n.to), n.type)) out.push(n);
  };
  switch (event.type) {
    case "gift.given":
      add({ type: "gift_confirmation", to: event.giver, giftId: event.giftId, totalCost: event.totalCost, remainingAllowance: event.remainingAllowance });
      for (const to of event.receivers) {
        add({ type: "gift_received", to, giftId: event.giftId, giver: event.giver, amount: event.perReceiver, channelId: ctx.gift?.channelId ?? null, text: ctx.gift?.text ?? null });
      }
      break;
    case "gift.rejected":
      add({ type: "gift_rejected", to: event.giver, error: event.error });
      break;
    case "adjustment.made":
      for (const to of event.memberIds) add({ type: "adjustment", to, kind: event.kind, amount: event.amount, reason: event.reason });
      break;
    default:
      break;
  }
  return out;
}

/** S84, S85: one weekly report per active member who keeps it on. */
export function weeklyReportPlan(data: BoardData, preferences: ReadonlyMap<MemberId, NotificationPreferences>, now: Instant): Extract<Notification, { type: "weekly_report" }>[] {
  return data.members
    .filter((r) => r.active && wants(preferences.get(r.id), "weekly_report"))
    .map((r) => ({ type: "weekly_report", to: r.id, report: weeklyReport(data, r.id, now) }) as const);
}
