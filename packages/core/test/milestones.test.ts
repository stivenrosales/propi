import { describe, expect, test } from "vitest";
import type { LocalDate, PosInt } from "../src/index.ts";
import {
  DEFAULT_MILESTONES,
  celebrationsDue,
  celebrationsOn,
  decideCelebrateMilestone,
  decideConfigureMilestones,
  decideSetMilestones,
  milestoneKey,
  type CelebrateMilestone,
  type MilestoneConfig,
  type MilestoneProfile,
} from "../src/milestones/index.ts";
import { WS, at, key, m, memberActor, record, settings } from "./fixtures.ts";

const D = (s: string) => s as LocalDate;
const config: MilestoneConfig = { channelId: "C-celebrate", localTime: "09:00", birthdayBonus: 10 as PosInt, anniversaryBonus: null };
const ana: MilestoneProfile = { memberId: m("ana"), birthday: { month: 11, day: 25 }, startDate: D("2023-11-25"), visibility: "public" };
const bob: MilestoneProfile = { memberId: m("bob"), birthday: { month: 2, day: 29 }, startDate: null, visibility: "private" };
const cy: MilestoneProfile = { memberId: m("cy"), birthday: { month: 11, day: 25 }, startDate: D("2026-11-25"), visibility: "none" };
const active = new Set(["ana", "bob", "cy"].map(m));
// 09:00 in Lima on 2026-11-25 = 14:00Z
const NINE = at("2026-11-25T14:00:00Z");

const celebrate = (over: Partial<CelebrateMilestone> = {}): CelebrateMilestone => ({
  type: "CelebrateMilestone",
  key: milestoneKey(m("ana"), "birthday", D("2026-11-25")),
  workspaceId: WS,
  actor: { kind: "system", job: "milestones" },
  at: NINE,
  memberId: m("ana"),
  kind: "birthday",
  date: D("2026-11-25"),
  ...over,
});
const snap = (profile: MilestoneProfile | null = ana) => ({ settings: settings(), config, profile, member: profile === null ? null : record(profile.memberId) });

describe("milestones", () => {
  test("S92: a member sets their own optional birthday (day, month) and start date; an admin may set anyone's", () => {
    const set = { type: "SetMilestones" as const, key: key("web:ms"), workspaceId: WS, actor: memberActor("ana"), at: NINE, memberId: m("ana"), birthday: { month: 11, day: 25 }, startDate: D("2023-11-25"), visibility: "public" as const };
    const d = decideSetMilestones({ member: record("ana") }, set, NINE);
    expect(d.writes).toEqual([{ t: "milestone.profile", profile: ana }]);
    expect(decideSetMilestones({ member: record("ana") }, { ...set, actor: memberActor("bob") }, NINE).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    expect(decideSetMilestones({ member: record("ana") }, { ...set, actor: memberActor("boss", "admin") }, NINE).outcome.ok).toBe(true);
    expect(decideSetMilestones({ member: record("ana") }, { ...set, birthday: { month: 2, day: 30 } }, NINE).outcome).toEqual({ ok: false, error: { code: "invalid_field", field: "birthday" } });
    expect(decideSetMilestones({ member: record("ana") }, { ...set, birthday: null, startDate: null }, NINE).outcome.ok).toBe(true);
  });

  test("S93: on the day, birthdays and work anniversaries (1+ years) are celebrated; Feb 29 falls on Feb 28 in other years", () => {
    expect(celebrationsOn([ana, bob, cy], active, D("2026-11-25"))).toEqual([
      { memberId: "ana", kind: "birthday", years: null, visibility: "public" },
      { memberId: "ana", kind: "anniversary", years: 3, visibility: "public" },
      { memberId: "cy", kind: "birthday", years: null, visibility: "none" },
    ]);
    expect(celebrationsOn([bob], active, D("2027-02-28")).map((c) => c.memberId)).toEqual(["bob"]);
    expect(celebrationsOn([bob], active, D("2028-02-28"))).toEqual([]);
    expect(celebrationsOn([ana], new Set(), D("2026-11-25"))).toEqual([]); // deactivated members are skipped
  });

  test("S93: celebrations are due at the configured local time in the workspace timezone", () => {
    expect(celebrationsDue([ana], active, config, at("2026-11-25T13:59:00Z"), "America/Lima", WS)).toEqual([]);
    const due = celebrationsDue([ana], active, config, NINE, "America/Lima", WS);
    expect(due.map((c) => c.key)).toEqual(["milestone:ana:birthday:2026-11-25", "milestone:ana:anniversary:2026-11-25"]);
    expect(decideCelebrateMilestone(snap(), celebrate(), at("2026-11-25T13:00:00Z")).outcome).toEqual({ ok: false, error: { code: "not_due", dueAt: NINE } });
  });

  test("S93: the member chooses public (channel post), private (DM only) or none", () => {
    expect(decideCelebrateMilestone(snap(), celebrate(), NINE).events).toEqual([
      { type: "milestone.celebrated", memberId: "ana", kind: "birthday", date: "2026-11-25", years: null, post: "channel", channelId: "C-celebrate" },
    ]);
    const bobDay = celebrate({ memberId: m("bob"), date: D("2027-02-28"), key: milestoneKey(m("bob"), "birthday", D("2027-02-28")), at: at("2027-02-28T14:00:00Z") });
    expect(decideCelebrateMilestone(snap(bob), bobDay, at("2027-02-28T14:00:00Z")).events[0]).toMatchObject({ post: "dm", channelId: null });
    const cyDay = celebrate({ memberId: m("cy") });
    expect(decideCelebrateMilestone(snap(cy), cyDay, NINE).events[0]).toMatchObject({ post: "none", channelId: null });
  });

  test("S94: an optional automatic bonus is recorded as a bonus entry with a milestone cause", () => {
    expect(decideCelebrateMilestone(snap(), celebrate(), NINE).entries).toEqual([
      { kind: "bonus", amount: 10, memberId: "ana", counterpartId: null, cause: { type: "milestone", milestone: "birthday", year: 2026 }, source: null, allowanceDay: null, reason: "birthday" },
    ]);
    const anniversary = decideCelebrateMilestone(snap(), celebrate({ kind: "anniversary", key: milestoneKey(m("ana"), "anniversary", D("2026-11-25")) }), NINE);
    expect(anniversary.outcome).toEqual({ ok: true, value: { memberId: "ana", kind: "anniversary", date: "2026-11-25", bonus: 0 } });
    expect(anniversary.entries).toEqual([]);
    expect(decideCelebrateMilestone(snap(), celebrate({ date: D("2026-11-24") }), NINE).outcome).toEqual({ ok: false, error: { code: "not_a_milestone", memberId: "ana" } });
  });

  test("S94: the celebration key is one per member, kind and date", () => {
    expect(milestoneKey(m("ana"), "anniversary", D("2026-11-25"))).toBe("milestone:ana:anniversary:2026-11-25");
    expect(DEFAULT_MILESTONES).toEqual({ channelId: null, localTime: "09:00", birthdayBonus: null, anniversaryBonus: null });
    const cfg = decideConfigureMilestones({ type: "ConfigureMilestones", key: key("api:mc"), workspaceId: WS, actor: memberActor("boss", "admin"), at: NINE, config }, NINE);
    expect(cfg.writes).toEqual([{ t: "milestone.config", config }]);
    expect(decideConfigureMilestones({ type: "ConfigureMilestones", key: key("api:mc"), workspaceId: WS, actor: memberActor("boss", "admin"), at: NINE, config: { ...config, localTime: "25:00" } }, NINE).outcome).toEqual({
      ok: false,
      error: { code: "invalid_field", field: "localTime" },
    });
  });
});
