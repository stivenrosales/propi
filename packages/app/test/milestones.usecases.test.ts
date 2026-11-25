import { describe, expect, test } from "vitest";
import type { Instant, LocalDate, PosInt } from "@propi/core";
import { dueCelebrations } from "../src/milestones/index.ts";
import { engagementSetup } from "./engagement.setup.ts";
import { T0, WS, admin, key, m, memberActor } from "./setup.ts";

// T0 = 2026-11-25 10:00 in Lima. 09:00 Lima = 14:00Z.
const EIGHT_LIMA = Date.UTC(2026, 10, 25, 13, 0) as Instant;
const config = { channelId: "C-fun", localTime: "09:00", birthdayBonus: 10 as PosInt, anniversaryBonus: null };

async function withAnaBirthday() {
  const ctx = engagementSetup();
  await ctx.run({ type: "ConfigureMilestones", key: key("api:ms"), workspaceId: WS, actor: admin, at: T0, config });
  const set = { type: "SetMilestones", key: key("web:ms:ana"), workspaceId: WS, actor: memberActor("ana"), at: T0, memberId: m("ana"), birthday: { month: 11, day: 25 }, startDate: "2024-11-25" as LocalDate, visibility: "public" } as const;
  expect(await ctx.run(set)).toMatchObject({ ok: true });
  return ctx;
}

describe("celebrations through the app", () => {
  test("S92: a member sets their own birthday and start date; others cannot", async () => {
    const { run, eng } = await withAnaBirthday();
    expect(eng.state(WS).profiles.get(m("ana"))).toEqual({ memberId: "ana", birthday: { month: 11, day: 25 }, startDate: "2024-11-25", visibility: "public" });
    const other = { type: "SetMilestones", key: key("web:ms:x"), workspaceId: WS, actor: memberActor("bob"), at: T0, memberId: m("ana"), birthday: null, startDate: null, visibility: "none" } as const;
    expect(await run(other)).toMatchObject({ ok: false, error: { code: "forbidden", need: "admin" } });
  });

  test("S93, S94: at the configured local time the day's celebrations post, and the birthday bonus is a bonus entry", async () => {
    const { run, app, mem, eng } = await withAnaBirthday();
    const due = await dueCelebrations({ ...eng.deps }, WS, T0);
    expect(due.map((c) => c.key)).toEqual(["milestone:ana:birthday:2026-11-25", "milestone:ana:anniversary:2026-11-25"]);
    for (const c of due) expect((await run(c)).ok).toBe(true);
    expect(mem.events(WS).map((e) => e.event)).toEqual([
      { type: "milestone.celebrated", memberId: "ana", kind: "birthday", date: "2026-11-25", years: null, post: "channel", channelId: "C-fun" },
      { type: "milestone.celebrated", memberId: "ana", kind: "anniversary", date: "2026-11-25", years: 2, post: "channel", channelId: "C-fun" },
    ]);
    expect(mem.entries(WS).map((e) => [e.kind, e.memberId, e.amount, e.cause])).toEqual([["bonus", "ana", 10, { type: "milestone", milestone: "birthday", year: 2026 }]]);
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 10 });
  });

  test("S94: celebrating is idempotent per member, kind and date", async () => {
    const { run, mem, eng } = await withAnaBirthday();
    const [birthday] = await dueCelebrations(eng.deps, WS, T0);
    await run(birthday!);
    expect(await run(birthday!)).toMatchObject({ ok: true, replayed: true });
    expect(await run({ ...birthday!, key: key("job:celebrate:retry") })).toMatchObject({ ok: true, replayed: true });
    expect(mem.entries(WS)).toHaveLength(1);
  });

  test("S93: before the local time nothing is due, and an early attempt does not consume the day's key", async () => {
    const { run, mem, eng } = await withAnaBirthday();
    mem.clock.set(EIGHT_LIMA);
    expect(await dueCelebrations(eng.deps, WS, EIGHT_LIMA)).toEqual([]);
    const [birthday] = await dueCelebrations(eng.deps, WS, T0);
    expect(await run(birthday!)).toMatchObject({ ok: false, error: { code: "not_due" } });
    mem.clock.set(T0);
    expect(await run(birthday!)).toMatchObject({ ok: true, replayed: false });
  });
});
