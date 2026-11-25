// S25-S27: daily allowance.
import type { Instant, LocalDate } from "../shared/types.ts";
import type { GiftSource } from "../ledger/entries.ts";
import type { MemberRecord } from "../members/members.ts";
import type { WorkspaceSettings } from "../workspace/settings.ts";
import { localDate } from "../workspace/time.ts";

/** S25, S26: per-member override, else the admin or workspace default. */
export function dailyLimit(member: Pick<MemberRecord, "role" | "dailyLimitOverride">, settings: WorkspaceSettings): number {
  if (member.dailyLimitOverride !== null) return member.dailyLimitOverride;
  return member.role === "admin" ? settings.adminDailyAllowance : settings.defaultDailyAllowance;
}

export const remainingAllowance = (limit: number, used: number): number => Math.max(0, limit - used);

/** Hook for the stickers module (S74): sticker gifts do not consume the allowance. */
export const consumesAllowance = (source: GiftSource): boolean => source !== "sticker";

/** S27: the allowance day is the local date in the workspace timezone; null when nothing is consumed. */
export function allowanceDayFor(source: GiftSource, now: Instant, tz: string): LocalDate | null {
  return consumesAllowance(source) ? localDate(now, tz) : null;
}
