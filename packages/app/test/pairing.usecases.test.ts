import { describe, expect, test } from "vitest";
import type { Instant } from "@propi/core";
import { currentPairingRound } from "../src/pairing/index.ts";
import { exchangePairKey } from "../src/pairing/core.ts";
import { engagementSetup } from "./engagement.setup.ts";
import { T0, WS, admin, giveCmd, key, m, memberActor, mention, msg } from "./setup.ts";

const WEEK = 7 * 86_400_000;
const config = { enabled: true, cadence: "weekly", avoidRepeatsWithin: 2, prompts: ["Favourite tool this week?"] } as const;

async function withOptIns(who = ["ana", "bob", "diana", "lind"]) {
  const ctx = engagementSetup();
  await ctx.run({ type: "ConfigurePairing", key: key("api:pairing"), workspaceId: WS, actor: admin, at: T0, config });
  for (const id of who) await ctx.run({ type: "SetPairingOptIn", key: key(`web:opt:${id}`), workspaceId: WS, actor: memberActor(id), at: T0, memberId: m(id), optedIn: true });
  return ctx;
}

const pairsOf = (groups: readonly (readonly string[])[]) => groups.flatMap((g) => g.flatMap((a, i) => g.slice(i + 1).map((b) => exchangePairKey(m(a), m(b)))));

describe("pairing through the app", () => {
  test("S95: opted-in members are grouped once per round, with a prompt; the round key dedupes re-runs", async () => {
    const { run, mem, eng } = await withOptIns(["ana", "bob", "diana", "lind", "giver"]);
    const cmd = (await currentPairingRound(eng.deps, WS, T0))!;
    expect(cmd.key).toBe("job:pairing:ws-1:2026-W48");
    const r = await run<{ groups: string[][] }>(cmd);
    expect(r.ok && r.value.groups.map((g) => g.length).sort()).toEqual([2, 3]);
    expect(mem.events(WS).at(-1)?.event).toMatchObject({ type: "pairing.round", round: "2026-W48", prompt: "Favourite tool this week?" });
    expect(await run(cmd)).toMatchObject({ ok: true, replayed: true });
    expect(eng.state(WS).rounds).toHaveLength(1);
  });

  test("S95: members who opted out or were deactivated are not paired", async () => {
    const { run, eng } = await withOptIns(["ana", "bob", "diana"]);
    await run({ type: "SetPairingOptIn", key: key("web:opt:diana:off"), workspaceId: WS, actor: memberActor("diana"), at: T0, memberId: m("diana"), optedIn: false });
    await run({ type: "SetPairingOptIn", key: key("web:opt:gone"), workspaceId: WS, actor: admin, at: T0, memberId: m("gone"), optedIn: true });
    const r = await run<{ groups: string[][] }>((await currentPairingRound(eng.deps, WS, T0))!);
    expect(r.ok && r.value.groups.map((g) => [...g].sort())).toEqual([["ana", "bob"]]);
  });

  test("S96: pairs avoid people who already exchange gifts, and never repeat within the last K rounds", async () => {
    const { run, app, mem, eng } = await withOptIns();
    await app.execute(giveCmd("ana", msg("@Bob :taco:", [mention("bob")], 1)));
    await app.execute(giveCmd("diana", msg("@Lind :taco:", [mention("lind")], 1)));
    const seen: string[][] = [];
    for (let week = 0; week < 3; week++) {
      const now = (T0 + week * WEEK) as Instant;
      mem.clock.set(now);
      const r = await run<{ groups: string[][] }>((await currentPairingRound(eng.deps, WS, now))!);
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      const pairs = pairsOf(r.value.groups);
      if (week === 0) expect(pairs).not.toContain(exchangePairKey(m("ana"), m("bob")));
      for (const prev of seen.slice(-2)) for (const p of pairs) expect(prev).not.toContain(p);
      seen.push(pairs);
    }
    expect(new Set(seen.flat()).size).toBe(6); // 3 rounds x 2 pairs, all distinct
  });

  test("S95: a round other than the current one is refused and does not consume its key", async () => {
    const { run, eng, mem } = await withOptIns();
    const next = (await currentPairingRound(eng.deps, WS, (T0 + WEEK) as Instant))!;
    expect(await run(next)).toMatchObject({ ok: false, error: { code: "round_not_current", current: "2026-W48" } });
    mem.clock.set((T0 + WEEK) as Instant);
    expect(await run(next)).toMatchObject({ ok: true, replayed: false });
  });
});
