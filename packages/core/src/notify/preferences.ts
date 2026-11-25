// S85: each member turns each notification type on or off. Everything is on by default.
export const NOTIFICATION_TYPES = ["gift_received", "gift_confirmation", "gift_rejected", "weekly_report", "nudge", "isolation_alert", "adjustment"] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationPreferences = Readonly<Partial<Record<NotificationType, boolean>>>;

export const wants = (prefs: NotificationPreferences | undefined, type: NotificationType): boolean => prefs?.[type] ?? true;

export function setPreference(prefs: NotificationPreferences | undefined, type: NotificationType, on: boolean): NotificationPreferences {
  return { ...prefs, [type]: on };
}
