// S95-S96: pairing rounds. Deterministic: the seed comes in with the command (core has no randomness).
import type { NewEntry } from "../ledger/entries.ts";
import { fail, isAdminOrSystem, ok, type ModuleDecision } from "../rules/module-decision.ts";
import { dateOfDay, dayNumber, isoWeekId, mondayOf, rulePeriodOfDate } from "../rules/periods.ts";
import type { CommandBase, CommandKey, Instant, MemberId, WorkspaceId } from "../shared/types.ts";
import type { WorkspaceSettings } from "../workspace/settings.ts";
import { localDate } from "../workspace/time.ts";

export type PairingCadence = "weekly" | "biweekly" | "monthly";

export interface PairingConfig {
  readonly enabled: boolean;
  readonly cadence: PairingCadence;
  /** S96: K, the number of most recent rounds in which a pair must not repeat. */
  readonly avoidRepeatsWithin: number;
  readonly prompts: readonly string[];
}

export const DEFAULT_PAIRING: PairingConfig = {
  enabled: false,
  cadence: "weekly",
  avoidRepeatsWithin: 4,
  prompts: ["What are you working on that you're excited about?", "What is something you learned recently?"],
};

export interface PairingRound {
  readonly round: string;
  readonly groups: readonly (readonly MemberId[])[];
  readonly prompt: string | null;
}

// ───────────── Commands, events, writes, port ─────────────

export interface ConfigurePairing extends CommandBase {
  readonly type: "ConfigurePairing";
  readonly config: PairingConfig;
}
export interface SetPairingOptIn extends CommandBase {
  readonly type: "SetPairingOptIn";
  readonly memberId: MemberId;
  readonly optedIn: boolean;
}
/** Keyed `job:pairing:<ws>:<round>`; `seed` makes the plan reproducible. */
export interface RunPairingRound extends CommandBase {
  readonly type: "RunPairingRound";
  readonly round: string;
  readonly seed: string;
}
export type PairingCommand = ConfigurePairing | SetPairingOptIn | RunPairingRound;

export type PairingEvent = { readonly type: "pairing.round"; readonly round: string; readonly groups: readonly (readonly MemberId[])[]; readonly prompt: string | null };

export type PairingWrite =
  | { readonly t: "pairing.config"; readonly config: PairingConfig }
  | { readonly t: "pairing.optin"; readonly memberId: MemberId; readonly optedIn: boolean }
  | { readonly t: "pairing.round"; readonly record: PairingRound };

export type PairingDecision<T> = ModuleDecision<T, PairingEvent, PairingWrite>;

export interface PairingStore {
  config(ws: WorkspaceId): Promise<PairingConfig>;
  optedIn(ws: WorkspaceId): Promise<readonly MemberId[]>;
  /** Past rounds, oldest first. */
  rounds(ws: WorkspaceId): Promise<readonly PairingRound[]>;
}

// ───────────── Schedule ─────────────

const EPOCH_MONDAY = 4; // 1970-01-05

/** S95: the round containing `now` in `tz`. */
export function pairingRoundOf(cadence: PairingCadence, now: Instant, tz: string): string {
  const date = localDate(now, tz);
  switch (cadence) {
    case "weekly":
      return isoWeekId(date);
    case "monthly":
      return rulePeriodOfDate("month", date);
    case "biweekly": {
      const week = Math.floor((dayNumber(mondayOf(date)) - EPOCH_MONDAY) / 7);
      const first = week - (((week % 2) + 2) % 2);
      return `${isoWeekId(dateOfDay(EPOCH_MONDAY + first * 7))}+2w`;
    }
  }
}

export const pairingKey = (ws: WorkspaceId, round: string): CommandKey => `job:pairing:${ws}:${round}` as CommandKey;

// ───────────── Planning ─────────────

export const exchangePairKey = (a: MemberId, b: MemberId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** S96: gifts exchanged per unordered pair (gift entries in either direction). */
export function pairExchangeCounts(entries: Iterable<NewEntry>): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    if (e.kind !== "gift" || e.counterpartId === null || e.counterpartId === e.memberId) continue;
    const k = exchangePairKey(e.memberId, e.counterpartId);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function fnv32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/** mulberry32: a tiny deterministic PRNG seeded from the command's seed. */
function prng(seed: string): () => number {
  let a = fnv32(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlanInput {
  readonly members: readonly MemberId[];
  readonly exchanges: ReadonlyMap<string, number>;
  /** Groups of the last K rounds. */
  readonly recent: readonly (readonly (readonly MemberId[])[])[];
  readonly seed: string;
}

const REPEAT_PENALTY = 1_000_000;

/** S95, S96: pairs (plus one trio when odd) minimizing exchanges, never repeating a recent pair if avoidable. */
export function planPairs(input: PlanInput): MemberId[][] {
  const pool = [...new Set(input.members)].sort();
  if (pool.length < 2) return [];
  const rand = prng(input.seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  if (pool.length === 3) return [pool];

  const recent = new Set<string>();
  for (const round of input.recent) for (const g of round) for (const a of g) for (const b of g) if (a < b) recent.add(exchangePairKey(a, b));
  const cost = (a: MemberId, b: MemberId) => (input.exchanges.get(exchangePairKey(a, b)) ?? 0) + (recent.has(exchangePairKey(a, b)) ? REPEAT_PENALTY : 0);
  const groupCost = (g: readonly MemberId[]) => {
    let t = 0;
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) t += cost(g[i]!, g[j]!);
    return t;
  };

  // Greedy: each member in seeded order takes the cheapest remaining partner.
  const groups: MemberId[][] = [];
  const rest = [...pool];
  while (rest.length >= 2) {
    const a = rest.shift()!;
    let best = 0;
    for (let i = 1; i < rest.length; i++) if (cost(a, rest[i]!) < cost(a, rest[best]!)) best = i;
    groups.push([a, rest.splice(best, 1)[0]!]);
  }
  // Odd count: the leftover joins the group where it adds the least cost.
  const left = rest[0];
  if (left !== undefined) {
    let best = 0;
    for (let i = 1; i < groups.length; i++) if (groupCost([...groups[i]!, left]) - groupCost(groups[i]!) < groupCost([...groups[best]!, left]) - groupCost(groups[best]!)) best = i;
    groups[best]!.push(left);
  }

  // Local improvement: swap members between two groups while the total cost drops.
  for (let improved = true, guard = 0; improved && guard < 100; guard++) {
    improved = false;
    for (let g = 0; g < groups.length; g++)
      for (let h = g + 1; h < groups.length; h++)
        for (let i = 0; i < groups[g]!.length; i++)
          for (let j = 0; j < groups[h]!.length; j++) {
            const x = [...groups[g]!];
            const y = [...groups[h]!];
            [x[i], y[j]] = [y[j]!, x[i]!];
            if (groupCost(x) + groupCost(y) < groupCost(groups[g]!) + groupCost(groups[h]!)) {
              groups[g] = x;
              groups[h] = y;
              improved = true;
            }
          }
  }
  return groups;
}

// ───────────── Deciders ─────────────

export interface PairingSnapshot {
  readonly settings: WorkspaceSettings;
  readonly config: PairingConfig;
  /** Opted-in, active members. */
  readonly members: readonly MemberId[];
  readonly exchanges: ReadonlyMap<string, number>;
  /** Past rounds, oldest first. */
  readonly history: readonly PairingRound[];
}

/** S95, S96: run the current round once (the key makes re-runs replay). */
export function decideRunPairingRound(s: PairingSnapshot, cmd: RunPairingRound, now: Instant): PairingDecision<PairingRound> {
  if (!isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  if (!s.config.enabled) return fail({ code: "module_disabled" });
  const current = pairingRoundOf(s.config.cadence, now, s.settings.timezone);
  if (cmd.round !== current) return fail({ code: "round_not_current", current });
  const k = Math.max(0, Math.floor(s.config.avoidRepeatsWithin));
  const recent = k === 0 ? [] : s.history.slice(-k).map((r) => r.groups);
  const groups = planPairs({ members: s.members, exchanges: s.exchanges, recent, seed: cmd.seed });
  const prompt = s.config.prompts.length === 0 ? null : s.config.prompts[fnv32(cmd.seed) % s.config.prompts.length]!;
  const record: PairingRound = { round: cmd.round, groups, prompt };
  return ok(record, { writes: [{ t: "pairing.round", record }], events: [{ type: "pairing.round", ...record }] });
}

/** S95: members opt in themselves; admins may change anyone. */
export function decideSetPairingOptIn(cmd: SetPairingOptIn, _now: Instant): PairingDecision<{ memberId: MemberId; optedIn: boolean }> {
  const self = cmd.actor.kind === "member" && cmd.actor.memberId === cmd.memberId;
  if (!self && !isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  return ok({ memberId: cmd.memberId, optedIn: cmd.optedIn }, { writes: [{ t: "pairing.optin", memberId: cmd.memberId, optedIn: cmd.optedIn }] });
}

/** S95: schedule, repeat window and prompts. */
export function decideConfigurePairing(cmd: ConfigurePairing, _now: Instant): PairingDecision<PairingConfig> {
  if (!isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  const c = cmd.config;
  if (!["weekly", "biweekly", "monthly"].includes(c.cadence)) return fail({ code: "invalid_field", field: "cadence" });
  if (!Number.isSafeInteger(c.avoidRepeatsWithin) || c.avoidRepeatsWithin < 0) return fail({ code: "invalid_field", field: "avoidRepeatsWithin" });
  return ok(c, { writes: [{ t: "pairing.config", config: c }] });
}
