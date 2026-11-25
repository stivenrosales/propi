import { describe, expect, test } from "vitest";
import type { PosInt } from "@propi/core";
import { questCommandsForEvent } from "../src/quests/index.ts";
import type { QuestInput } from "../src/quests/core.ts";
import { engagementSetup } from "./engagement.setup.ts";
import { T0, WS, admin, giveCmd, key, m, memberActor, mention, msg } from "./setup.ts";

const HOUR = 3_600_000;
const input = (over: Partial<QuestInput> = {}): QuestInput => ({
  id: "q1",
  title: "Run a demo",
  description: "Show the team something new",
  image: null,
  reward: { mode: "fixed", amount: 5 as PosInt },
  submitters: "both",
  proofRequired: false,
  approvalRequired: true,
  timeline: true,
  perSubmitterCap: null,
  teamCap: null,
  cooldownMs: 0,
  opensAt: null,
  closesAt: null,
  trigger: null,
  ...over,
});
const base = (k: string) => ({ key: key(k), workspaceId: WS, at: T0 });
const define = (over: Partial<QuestInput> = {}) => ({ ...base(`api:quest:${JSON.stringify(over)}`), type: "DefineQuest", actor: admin, quest: input(over) }) as const;
const publish = (questId = "q1") => ({ ...base(`api:publish:${questId}`), type: "PublishQuest", actor: admin, questId }) as const;
const close = (questId = "q1") => ({ ...base(`api:close:${questId}`), type: "CloseQuest", actor: admin, questId }) as const;
const submit = (who: string, k: string, questId = "q1") => ({ ...base(k), type: "SubmitQuest", actor: memberActor(who), questId, memberId: m(who), proof: null, note: null }) as const;
const review = (submissionId: string, verdict: "approve" | "reject", k: string) =>
  ({ ...base(k), type: "ReviewSubmission", actor: memberActor("boss", "admin"), submissionId, verdict, amount: null, note: null }) as const;

async function openQuest(over: Partial<QuestInput> = {}) {
  const ctx = engagementSetup();
  await ctx.run(define(over));
  await ctx.run(publish(over.id ?? "q1"));
  return ctx;
}

describe("quests through the app", () => {
  test("S64, S65: an admin creates a draft, publishes it and closes it", async () => {
    const { run, eng, mem } = engagementSetup();
    expect(await run(define())).toEqual({ ok: true, replayed: false, value: { questId: "q1", state: "draft" } });
    expect(await run(submit("ana", "web:s:0"))).toMatchObject({ ok: false, error: { code: "quest_not_open" } });
    expect(await run(publish())).toEqual({ ok: true, replayed: false, value: { questId: "q1", state: "open" } });
    expect(await run(close())).toEqual({ ok: true, replayed: false, value: { questId: "q1", state: "closed" } });
    expect(eng.state(WS).quests.get("q1")?.state).toBe("closed");
    expect(mem.events(WS).map((e) => e.event.type)).toEqual(["quest.opened", "quest.closed"]);
    expect(mem.lockLog.at(-1)).toEqual(["quest:q1"]);
  });

  test("S66, S67: a pending submission is approved by an approver and pays a quest_reward to redeemable only", async () => {
    const { run, app, mem, eng } = await openQuest();
    expect(await run(submit("ana", "web:s:1"))).toEqual({ ok: true, replayed: false, value: { submissionId: "submission-1", state: "pending", reward: 0 } });
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 0 });
    expect(await run(review("submission-1", "approve", "web:r:1"))).toEqual({ ok: true, replayed: false, value: { submissionId: "submission-1", state: "approved", reward: 5 } });
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 5 });
    expect(mem.entries(WS).map((e) => [e.kind, e.memberId, e.amount, e.cause])).toEqual([["quest_reward", "ana", 5, { type: "quest", submissionId: "submission-1" }]]);
    expect(eng.state(WS).submissions.get("submission-1")).toMatchObject({ state: "approved", reviewedBy: "boss" });
    expect(await run(review("submission-1", "approve", "web:r:2"))).toMatchObject({ ok: false, error: { code: "invalid_transition", from: "approved", to: "approved" } });
    expect(mem.entries(WS)).toHaveLength(1);
  });

  test("S65: pending submissions can still be reviewed after the quest closes; new ones cannot be made", async () => {
    const { run, mem } = await openQuest();
    await run(submit("ana", "web:s:1"));
    await run(close());
    expect(await run(submit("bob", "web:s:2"))).toMatchObject({ ok: false, error: { code: "quest_not_open" } });
    expect(await run(review("submission-1", "reject", "web:r:1"))).toMatchObject({ ok: true, value: { state: "rejected" } });
    expect(mem.entries(WS)).toEqual([]);
  });

  test("S66: a rejected submitter resubmits after the cooldown", async () => {
    const { run, mem } = await openQuest({ cooldownMs: 24 * HOUR });
    await run(submit("ana", "web:s:1"));
    await run(review("submission-1", "reject", "web:r:1"));
    expect(await run(submit("ana", "web:s:2"))).toMatchObject({ ok: false, error: { code: "cooldown", until: T0 + 24 * HOUR } });
    mem.clock.advance(24 * HOUR);
    expect(await run(submit("ana", "web:s:3"))).toMatchObject({ ok: true, value: { state: "pending" } });
  });

  test("S64: the team cap holds when many members submit at once (Quest.tla CapRespected, PaidOnlyForApprovals)", async () => {
    const { run, mem } = await openQuest({ approvalRequired: false, teamCap: 2 as PosInt });
    const who = ["ana", "bob", "diana", "lind", "giver"];
    const results = await Promise.all(who.map((w, i) => run(submit(w, `web:s:${i}`))));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error))).toEqual(Array(3).fill({ code: "cap_reached", cap: "team" }));
    expect(mem.entries(WS).filter((e) => e.kind === "quest_reward").reduce((t, e) => t + e.amount, 0)).toBe(10);
  });

  test("S66: approve and reject racing on one submission: one wins, at most one payment", async () => {
    const { run, mem } = await openQuest();
    await run(submit("ana", "web:s:1"));
    const [a, b] = await Promise.all([run(review("submission-1", "approve", "web:r:a")), run(review("submission-1", "reject", "web:r:b"))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(mem.entries(WS).filter((e) => e.kind === "quest_reward").length).toBeLessThanOrEqual(1);
  });

  test("S68: a gift.given event completes a 'first gift given' quest automatically, once", async () => {
    const { run, app, mem, eng } = await openQuest({ id: "first-gift", title: "First gift", approvalRequired: false, perSubmitterCap: 1 as PosInt, trigger: { event: "gift.given", who: "giver" } });
    await app.execute(giveCmd("giver", msg("@Ana :taco:", [mention("ana")], 1)));
    await app.execute(giveCmd("giver", msg("@Bob :taco:", [mention("bob")], 1)));
    // The relay: for each committed event, map it to commands and execute them.
    const relay = async () => {
      const results = [];
      for (const row of mem.events(WS).filter((e) => e.event.type === "gift.given")) for (const cmd of await questCommandsForEvent(eng.deps, row)) results.push(await run(cmd));
      return results;
    };
    const first = await relay();
    expect(first.map((r) => (r.ok ? r.value : r.error))).toEqual([
      { submissionId: expect.any(String), state: "approved", reward: 5 },
      { code: "cap_reached", cap: "member" },
    ]);
    expect(await app.balances(WS, m("giver"))).toEqual({ received: 0, given: 2, redeemable: 5 });
    // Replaying the outbox (a relay restart) changes nothing.
    expect((await relay()).every((r) => r.replayed)).toBe(true);
    expect(mem.entries(WS).filter((e) => e.kind === "quest_reward")).toHaveLength(1);
  });
});
