import { describe, expect, test } from "vitest";
import type { MemberId, NewEntry, PosInt } from "../src/index.ts";
import {
  DEFAULT_PAIRING,
  decideConfigurePairing,
  decideRunPairingRound,
  decideSetPairingOptIn,
  pairExchangeCounts,
  exchangePairKey,
  pairingKey,
  planPairs,
  pairingRoundOf,
  type PairingConfig,
  type PairingSnapshot,
  type RunPairingRound,
} from "../src/pairing/index.ts";
import { WS, at, gid, key, m, memberActor, settings } from "./fixtures.ts";

const ids = (...xs: string[]) => xs.map(m);
const sortGroups = (groups: readonly (readonly MemberId[])[]) => groups.map((g) => [...g].sort()).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
const NOW = at("2026-11-25T15:00:00Z"); // Wednesday of ISO week 2026-W48 in Lima
const config: PairingConfig = { enabled: true, cadence: "weekly", avoidRepeatsWithin: 2, prompts: ["What did you learn this week?", "Best snack in the office?"] };
const gift = (a: string, b: string): NewEntry => ({ kind: "gift", amount: 1 as PosInt, memberId: m(b), counterpartId: m(a), cause: { type: "gift", giftId: gid("g") }, source: "message", allowanceDay: null, reason: null });

const snap = (over: Partial<PairingSnapshot> = {}): PairingSnapshot => ({
  settings: settings(),
  config,
  members: ids("ana", "bob", "cy", "dee"),
  exchanges: new Map(),
  history: [],
  ...over,
});
const run = (over: Partial<RunPairingRound> = {}): RunPairingRound => ({
  type: "RunPairingRound",
  key: pairingKey(WS, "2026-W48"),
  workspaceId: WS,
  actor: { kind: "system", job: "pairing" },
  at: NOW,
  round: "2026-W48",
  seed: "2026-W48",
  ...over,
});

describe("pairing", () => {
  test("S95: rounds follow the schedule (weekly, biweekly, monthly) in the workspace timezone", () => {
    expect(pairingRoundOf("weekly", NOW, "America/Lima")).toBe("2026-W48");
    expect(pairingRoundOf("monthly", NOW, "America/Lima")).toBe("2026-11");
    const bw = pairingRoundOf("biweekly", NOW, "America/Lima");
    expect(pairingRoundOf("biweekly", at("2026-11-18T15:00:00Z"), "America/Lima") === bw || pairingRoundOf("biweekly", at("2026-12-02T15:00:00Z"), "America/Lima") === bw).toBe(true);
    expect(pairingRoundOf("biweekly", at("2026-11-18T15:00:00Z"), "America/Lima")).not.toBe(pairingRoundOf("biweekly", at("2026-12-02T15:00:00Z"), "America/Lima"));
    expect(decideRunPairingRound(snap(), run({ round: "2026-W47" }), NOW).outcome).toEqual({ ok: false, error: { code: "round_not_current", current: "2026-W48" } });
    expect(pairingKey(WS, "2026-W48")).toBe("job:pairing:ws-1:2026-W48");
  });

  test("S95: opted-in members are paired, with one group of 3 when the count is odd", () => {
    expect(sortGroups(planPairs({ members: ids("ana", "bob", "cy", "dee"), exchanges: new Map(), recent: [], seed: "s" })).map((g) => g.length)).toEqual([2, 2]);
    const odd = planPairs({ members: ids("ana", "bob", "cy", "dee", "eve"), exchanges: new Map(), recent: [], seed: "s" });
    expect(odd.map((g) => g.length).sort()).toEqual([2, 3]);
    expect(new Set(odd.flat()).size).toBe(5);
    expect(planPairs({ members: ids("ana"), exchanges: new Map(), recent: [], seed: "s" })).toEqual([]);
    expect(planPairs({ members: ids("ana", "bob", "cy"), exchanges: new Map(), recent: [], seed: "s" }).map((g) => g.length)).toEqual([3]);
  });

  test("S95: the round posts a group DM per group with a conversation prompt", () => {
    const d = decideRunPairingRound(snap(), run(), NOW);
    expect(d.outcome.ok).toBe(true);
    const groups = d.outcome.ok ? d.outcome.value.groups : [];
    expect(d.events).toEqual([{ type: "pairing.round", round: "2026-W48", groups, prompt: expect.any(String) }]);
    expect(config.prompts).toContain((d.events[0] as { prompt: string }).prompt);
    expect(d.writes).toEqual([{ t: "pairing.round", record: { round: "2026-W48", groups, prompt: (d.events[0] as { prompt: string }).prompt } }]);
    expect(decideRunPairingRound(snap({ config: DEFAULT_PAIRING }), run(), NOW).outcome).toEqual({ ok: false, error: { code: "module_disabled" } });
  });

  test("S96: pairing prefers people who exchanged the fewest gifts with each other", () => {
    const exchanges = pairExchangeCounts([gift("ana", "bob"), gift("bob", "ana"), gift("ana", "bob"), gift("cy", "dee"), gift("dee", "cy")]);
    expect(exchanges.get(exchangePairKey(m("bob"), m("ana")))).toBe(3);
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const groups = sortGroups(planPairs({ members: ids("ana", "bob", "cy", "dee"), exchanges, recent: [], seed }));
      expect(groups).not.toContainEqual(["ana", "bob"]);
      expect(groups).not.toContainEqual(["cy", "dee"]);
    }
  });

  test("S96: a pair is not repeated within the last K rounds; older rounds no longer count", () => {
    const history = [
      { round: "2026-W45", groups: [ids("ana", "cy"), ids("bob", "dee")], prompt: null },
      { round: "2026-W46", groups: [ids("ana", "bob"), ids("cy", "dee")], prompt: null },
      { round: "2026-W47", groups: [ids("ana", "dee"), ids("bob", "cy")], prompt: null },
    ];
    // K = 2: W46 and W47 are recent, so only ana-cy / bob-dee (from W45) is allowed.
    const d = decideRunPairingRound(snap({ history }), run(), NOW);
    expect(d.outcome.ok && sortGroups(d.outcome.value.groups)).toEqual([["ana", "cy"], ["bob", "dee"]]);
  });

  test("S95, S96: the plan is deterministic for a given seed (core has no randomness)", () => {
    const input = { members: ids("ana", "bob", "cy", "dee", "eve", "fay"), exchanges: new Map<string, number>(), recent: [], seed: "2026-W48" };
    expect(planPairs(input)).toEqual(planPairs(input));
    const seeds = new Set(["x1", "x2", "x3", "x4", "x5", "x6"].map((seed) => JSON.stringify(sortGroups(planPairs({ ...input, seed })))));
    expect(seeds.size).toBeGreaterThan(1);
  });

  test("S95: members opt in or out of pairing; an admin configures the schedule", () => {
    const opt = decideSetPairingOptIn({ type: "SetPairingOptIn", key: key("web:opt"), workspaceId: WS, actor: memberActor("ana"), at: NOW, memberId: m("ana"), optedIn: true }, NOW);
    expect(opt.writes).toEqual([{ t: "pairing.optin", memberId: "ana", optedIn: true }]);
    expect(decideSetPairingOptIn({ type: "SetPairingOptIn", key: key("web:opt"), workspaceId: WS, actor: memberActor("bob"), at: NOW, memberId: m("ana"), optedIn: true }, NOW).outcome).toEqual({
      ok: false,
      error: { code: "forbidden", need: "admin" },
    });
    const cfg = decideConfigurePairing({ type: "ConfigurePairing", key: key("api:pc"), workspaceId: WS, actor: memberActor("boss", "admin"), at: NOW, config }, NOW);
    expect(cfg.writes).toEqual([{ t: "pairing.config", config }]);
  });
});
