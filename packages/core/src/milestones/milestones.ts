// S92-S94: birthdays and work anniversaries, the celebration plan, and the optional bonus.
import type { NewEntry } from "../ledger/entries.ts";
import type { MemberRecord } from "../members/members.ts";
import { zonedLocalToInstant } from "../migration/zoned.ts";
import { fail, isAdminOrSystem, ok, type ModuleDecision } from "../rules/module-decision.ts";
import { dateOfDay, dayNumber } from "../rules/periods.ts";
import type { CommandBase, CommandKey, Instant, LocalDate, MemberId, PosInt, WorkspaceId } from "../shared/types.ts";
import { isPosInt } from "../shared/types.ts";
import type { WorkspaceSettings } from "../workspace/settings.ts";
import { localDate } from "../workspace/time.ts";

export interface MonthDay {
  readonly month: number; // 1-12
  readonly day: number;
}

/** S93: public = channel post, private = DM only, none = no message. */
export type CelebrationVisibility = "public" | "private" | "none";
export type MilestoneKind = "birthday" | "anniversary";

export interface MilestoneProfile {
  readonly memberId: MemberId;
  readonly birthday: MonthDay | null;
  readonly startDate: LocalDate | null;
  readonly visibility: CelebrationVisibility;
}

export interface MilestoneConfig {
  readonly channelId: string | null;
  /** Local wall-clock time "HH:MM" in the workspace timezone. */
  readonly localTime: string;
  /** S94: optional automatic bonuses, recorded as bonus entries. */
  readonly birthdayBonus: PosInt | null;
  readonly anniversaryBonus: PosInt | null;
}

export const DEFAULT_MILESTONES: MilestoneConfig = { channelId: null, localTime: "09:00", birthdayBonus: null, anniversaryBonus: null };

export interface Celebration {
  readonly memberId: MemberId;
  readonly kind: MilestoneKind;
  /** Completed years, for anniversaries. */
  readonly years: number | null;
  readonly visibility: CelebrationVisibility;
}

// ───────────── Commands, events, writes, port ─────────────

export interface SetMilestones extends CommandBase {
  readonly type: "SetMilestones";
  readonly memberId: MemberId;
  readonly birthday: MonthDay | null;
  readonly startDate: LocalDate | null;
  readonly visibility: CelebrationVisibility;
}
export interface ConfigureMilestones extends CommandBase {
  readonly type: "ConfigureMilestones";
  readonly config: MilestoneConfig;
}
/** Keyed `milestone:<member>:<kind>:<date>` (one per member, kind and date). */
export interface CelebrateMilestone extends CommandBase {
  readonly type: "CelebrateMilestone";
  readonly memberId: MemberId;
  readonly kind: MilestoneKind;
  readonly date: LocalDate;
}
export type MilestoneCommand = SetMilestones | ConfigureMilestones | CelebrateMilestone;

export type MilestoneEvent = {
  readonly type: "milestone.celebrated";
  readonly memberId: MemberId;
  readonly kind: MilestoneKind;
  readonly date: LocalDate;
  readonly years: number | null;
  readonly post: "channel" | "dm" | "none";
  readonly channelId: string | null;
};

export type MilestoneWrite =
  | { readonly t: "milestone.profile"; readonly profile: MilestoneProfile }
  | { readonly t: "milestone.config"; readonly config: MilestoneConfig };

export type MilestoneDecision<T> = ModuleDecision<T, MilestoneEvent, MilestoneWrite>;

export interface MilestoneStore {
  config(ws: WorkspaceId): Promise<MilestoneConfig>;
  profile(ws: WorkspaceId, member: MemberId): Promise<MilestoneProfile | null>;
  profiles(ws: WorkspaceId): Promise<readonly MilestoneProfile[]>;
}

// ───────────── Pure helpers ─────────────

export const milestoneKey = (member: MemberId, kind: MilestoneKind, date: LocalDate): CommandKey => `milestone:${member}:${kind}:${date}` as CommandKey;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const validMonthDay = (md: MonthDay) => Number.isInteger(md.month) && md.month >= 1 && md.month <= 12 && Number.isInteger(md.day) && md.day >= 1 && md.day <= DAYS[md.month - 1]!;
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && dateOfDay(dayNumber(d as LocalDate)) === d;
const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** Does a yearly month/day fall on `date`? Feb 29 is celebrated on Feb 28 in non-leap years. */
function fallsOn(md: MonthDay, date: LocalDate): boolean {
  const y = Number(date.slice(0, 4));
  const mm = Number(date.slice(5, 7));
  const dd = Number(date.slice(8, 10));
  if (md.month === 2 && md.day === 29 && !isLeap(y)) return mm === 2 && dd === 28;
  return md.month === mm && md.day === dd;
}

/** S93: who celebrates what on a local date. Deactivated members are skipped. */
export function celebrationsOn(profiles: readonly MilestoneProfile[], active: ReadonlySet<MemberId>, date: LocalDate): Celebration[] {
  const out: Celebration[] = [];
  for (const p of profiles) {
    if (!active.has(p.memberId)) continue;
    if (p.birthday !== null && fallsOn(p.birthday, date)) out.push({ memberId: p.memberId, kind: "birthday", years: null, visibility: p.visibility });
    if (p.startDate !== null) {
      const years = Number(date.slice(0, 4)) - Number(p.startDate.slice(0, 4));
      const md = { month: Number(p.startDate.slice(5, 7)), day: Number(p.startDate.slice(8, 10)) };
      if (years >= 1 && fallsOn(md, date)) out.push({ memberId: p.memberId, kind: "anniversary", years, visibility: p.visibility });
    }
  }
  return out;
}

/** S93: the instant of the configured local time on `date`. */
export const celebrationTime = (config: MilestoneConfig, date: LocalDate, tz: string): Instant => zonedLocalToInstant(`${date} ${config.localTime}`, tz);

/** S93: today's celebrations once the configured local time has passed, as keyed commands. */
export function celebrationsDue(
  profiles: readonly MilestoneProfile[],
  active: ReadonlySet<MemberId>,
  config: MilestoneConfig,
  now: Instant,
  tz: string,
  ws: WorkspaceId,
): CelebrateMilestone[] {
  const date = localDate(now, tz);
  const time = celebrationTime(config, date, tz);
  if (now < time) return [];
  return celebrationsOn(profiles, active, date).map((c) => ({
    type: "CelebrateMilestone",
    key: milestoneKey(c.memberId, c.kind, date),
    workspaceId: ws,
    actor: { kind: "system", job: "milestones" },
    at: time,
    memberId: c.memberId,
    kind: c.kind,
    date,
  }));
}

// ───────────── Deciders ─────────────

/** S92: the member sets their own dates; an admin may set anyone's. */
export function decideSetMilestones(s: { readonly member: MemberRecord | null }, cmd: SetMilestones, _now: Instant): MilestoneDecision<MilestoneProfile> {
  const self = cmd.actor.kind === "member" && cmd.actor.memberId === cmd.memberId;
  if (!self && !isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  if (s.member === null) return fail({ code: "not_found", what: "member" });
  if (cmd.birthday !== null && !validMonthDay(cmd.birthday)) return fail({ code: "invalid_field", field: "birthday" });
  if (cmd.startDate !== null && !validDate(cmd.startDate)) return fail({ code: "invalid_field", field: "startDate" });
  if (!["public", "private", "none"].includes(cmd.visibility)) return fail({ code: "invalid_field", field: "visibility" });
  const profile: MilestoneProfile = { memberId: cmd.memberId, birthday: cmd.birthday, startDate: cmd.startDate, visibility: cmd.visibility };
  return ok(profile, { writes: [{ t: "milestone.profile", profile }] });
}

/** S93, S94: channel, local time and optional bonuses. */
export function decideConfigureMilestones(cmd: ConfigureMilestones, _now: Instant): MilestoneDecision<MilestoneConfig> {
  if (!isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  const c = cmd.config;
  if (!validTime(c.localTime)) return fail({ code: "invalid_field", field: "localTime" });
  if (c.birthdayBonus !== null && !isPosInt(c.birthdayBonus)) return fail({ code: "invalid_field", field: "birthdayBonus" });
  if (c.anniversaryBonus !== null && !isPosInt(c.anniversaryBonus)) return fail({ code: "invalid_field", field: "anniversaryBonus" });
  return ok(c, { writes: [{ t: "milestone.config", config: c }] });
}

export interface CelebrateSnapshot {
  readonly settings: WorkspaceSettings;
  readonly config: MilestoneConfig;
  readonly profile: MilestoneProfile | null;
  readonly member: MemberRecord | null;
}

/** S93, S94: celebrate one member's milestone on a date, at or after the configured local time. */
export function decideCelebrateMilestone(
  s: CelebrateSnapshot,
  cmd: CelebrateMilestone,
  now: Instant,
): MilestoneDecision<{ memberId: MemberId; kind: MilestoneKind; date: LocalDate; bonus: number }> {
  if (!isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  if (s.member !== null && !s.member.active) return fail({ code: "inactive_member" });
  const found =
    s.profile === null || s.member === null
      ? undefined
      : celebrationsOn([s.profile], new Set([s.member.id]), cmd.date).find((c) => c.kind === cmd.kind && c.memberId === cmd.memberId);
  if (found === undefined) return fail({ code: "not_a_milestone", memberId: cmd.memberId });
  const dueAt = celebrationTime(s.config, cmd.date, s.settings.timezone);
  if (now < dueAt) return fail({ code: "not_due", dueAt });

  const bonus = cmd.kind === "birthday" ? s.config.birthdayBonus : s.config.anniversaryBonus;
  const entries: NewEntry[] =
    bonus === null
      ? []
      : [
          {
            kind: "bonus",
            amount: bonus,
            memberId: cmd.memberId,
            counterpartId: null,
            cause: { type: "milestone", milestone: cmd.kind, year: Number(cmd.date.slice(0, 4)) },
            source: null,
            allowanceDay: null,
            reason: cmd.kind === "birthday" ? "birthday" : "work anniversary",
          },
        ];
  const post = found.visibility === "public" ? "channel" : found.visibility === "private" ? "dm" : "none";
  return ok(
    { memberId: cmd.memberId, kind: cmd.kind, date: cmd.date, bonus: bonus ?? 0 },
    {
      entries,
      events: [
        { type: "milestone.celebrated", memberId: cmd.memberId, kind: cmd.kind, date: cmd.date, years: found.years, post, channelId: post === "channel" ? s.config.channelId : null },
      ],
    },
  );
}
