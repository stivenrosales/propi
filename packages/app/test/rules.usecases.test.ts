import { describe, expect, test } from "vitest";
import type { Instant, PosInt } from "@propi/core";
import { dueRuleEvaluations } from "../src/rules/index.ts";
import { evaluateRuleCommand, rulePeriodRange } from "../src/rules/core.ts";
import { engagementSetup } from "./engagement.setup.ts";
import { WS, admin, giveCmd, key, m, mention, msg } from "./setup.ts";

const NOV = rulePeriodRange("month", "2026-11", "America/Lima")!;
const DEC_2 = Date.UTC(2026, 11, 2, 15) as Instant;

const defineTopReceiver = {
  type: "DefineAwardRule",
  key: key("api:t:rule"),
  workspaceId: WS,
  actor: admin,
  at: NOV.start,
  rule: { id: "r1", name: "Top receiver of the month", period: "month", criterion: { kind: "top_receivers", n: 1 as PosInt }, reward: 20 as PosInt, announceChannel: "C-wins" },
} as const;

async function novemberWithGifts() {
  const ctx = engagementSetup();
  expect(await ctx.run(defineTopReceiver)).toEqual({ ok: true, replayed: false, value: { ruleId: "r1" } });
  await ctx.app.execute(giveCmd("giver", msg("@Ana :taco::taco::taco:", [mention("ana")], 3)));
  await ctx.app.execute(giveCmd("bob", msg("@Lind :taco:", [mention("lind")], 1)));
  return ctx;
}

describe("award rules through the app", () => {
  test("S60, S63: the top receiver of November gets +20 redeemable; received does not change", async () => {
    const { run, app, mem } = await novemberWithGifts();
    mem.clock.set(DEC_2);
    const r = await run(evaluateRuleCommand(WS, "r1", "2026-11", NOV.end));
    expect(r).toEqual({ ok: true, replayed: false, value: { ruleId: "r1", period: "2026-11", winners: ["ana"], amount: 20 } });
    expect(await app.balances(WS, m("ana"))).toEqual({ received: 3, given: 0, redeemable: 23 });
    expect(mem.entries(WS).filter((e) => e.kind === "rule_award").map((e) => [e.memberId, e.amount, e.commandKey])).toEqual([["ana", 20, "rule:r1:2026-11"]]);
    expect(mem.events(WS).at(-1)?.event).toEqual({ type: "rule.awarded", ruleId: "r1", period: "2026-11", winners: ["ana"], amount: 20, announceChannel: "C-wins" });
    expect((await app.ledgerCheck(WS)).ok).toBe(true);
  });

  test("S61: the scheduler gets each rule's last closed period; an early attempt is refused and does not consume the period's key", async () => {
    const { run, mem, eng } = await novemberWithGifts();
    const early = await run(evaluateRuleCommand(WS, "r1", "2026-11", NOV.end));
    expect(early).toEqual({ ok: false, replayed: false, error: { code: "period_not_closed", closesAt: NOV.end } });
    mem.clock.set(DEC_2);
    const due = await dueRuleEvaluations({ ...eng.deps, directory: eng.deps.directory }, WS, DEC_2);
    expect(due.map((c) => c.key)).toEqual(["rule:r1:2026-11"]);
    expect((await run(due[0]!)).ok).toBe(true);
    expect(mem.entries(WS).filter((e) => e.kind === "rule_award")).toHaveLength(1);
  });

  test("S62: re-running the evaluation, even under another command key, never pays twice", async () => {
    const { run, mem } = await novemberWithGifts();
    mem.clock.set(DEC_2);
    const cmd = evaluateRuleCommand(WS, "r1", "2026-11", NOV.end);
    await run(cmd);
    expect(await run(cmd)).toMatchObject({ ok: true, replayed: true });
    expect(await run({ ...cmd, key: key("scheduler:retry:42") })).toMatchObject({ ok: true, replayed: true });
    expect(mem.entries(WS).filter((e) => e.kind === "rule_award")).toHaveLength(1);
  });

  test("S62: concurrent evaluations of the same rule and period write one award", async () => {
    const { run, mem } = await novemberWithGifts();
    mem.clock.set(DEC_2);
    const cmd = evaluateRuleCommand(WS, "r1", "2026-11", NOV.end);
    const results = await Promise.all(Array.from({ length: 5 }, () => run(cmd)));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(mem.entries(WS).filter((e) => e.kind === "rule_award")).toHaveLength(1);
  });
});
