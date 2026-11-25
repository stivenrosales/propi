// Pairing chats (S95-S96). One round per (workspace, round id): the job key is the guard.
import type { CommandKey, Decision, Directory, Instant, Reader, WorkspaceId } from "@propi/core";
import { defineHandler } from "../handler.ts";
import { activeMembers } from "../rules/handlers.ts";
import type { ModuleDecision } from "../rules/core.ts";
import {
  decideConfigurePairing,
  decideRunPairingRound,
  decideSetPairingOptIn,
  pairExchangeCounts,
  pairingKey,
  pairingRoundOf,
  type ConfigurePairing,
  type PairingConfig,
  type PairingRound,
  type PairingSnapshot,
  type PairingStore,
  type RunPairingRound,
  type SetPairingOptIn,
} from "./core.ts";

export interface PairingDeps {
  readonly reader: Reader;
  readonly pairing: PairingStore;
}

export type PairingResults = {
  ConfigurePairing: PairingConfig;
  SetPairingOptIn: { memberId: string; optedIn: boolean };
  RunPairingRound: PairingRound;
};

const widen = <T>(d: ModuleDecision<T, unknown, unknown>): Decision<T> => d as unknown as Decision<T>;

export function pairingHandlers(deps: PairingDeps) {
  return [
    defineHandler<ConfigurePairing, null, PairingResults["ConfigurePairing"]>({
      type: "ConfigurePairing",
      locks: () => [],
      load: async () => null,
      decide: (_s, cmd, now) => widen(decideConfigurePairing(cmd, now)),
    }),

    defineHandler<SetPairingOptIn, null, PairingResults["SetPairingOptIn"]>({
      type: "SetPairingOptIn",
      locks: () => [],
      load: async () => null,
      decide: (_s, cmd, now) => widen(decideSetPairingOptIn(cmd, now)),
    }),

    defineHandler<RunPairingRound, PairingSnapshot, PairingResults["RunPairingRound"]>({
      type: "RunPairingRound",
      locks: () => [],
      // The round key is used only for the current round, so a refused future round cannot consume it.
      async resolveKey(cmd, _tx, ctx) {
        const key = pairingKey(cmd.workspaceId, cmd.round);
        const config = await deps.pairing.config(cmd.workspaceId);
        return pairingRoundOf(config.cadence, ctx.now, ctx.settings.timezone) === cmd.round ? key : (`${key}:not-current` as CommandKey);
      },
      async load(cmd, _tx, ctx) {
        const ws = cmd.workspaceId;
        const active = await activeMembers(ctx.directory, ws);
        return {
          settings: ctx.settings,
          config: await deps.pairing.config(ws),
          members: (await deps.pairing.optedIn(ws)).filter((id) => active.has(id)),
          exchanges: pairExchangeCounts(await deps.reader.workspace(ws).entries()),
          history: await deps.pairing.rounds(ws),
        };
      },
      decide: (s, cmd, now) => widen(decideRunPairingRound(s, cmd, now)),
    }),
  ];
}

/** S95: the current round's command, seeded by workspace and round (deterministic; the key dedupes). */
export async function currentPairingRound(deps: PairingDeps & { readonly directory: Directory }, ws: WorkspaceId, now: Instant): Promise<RunPairingRound | null> {
  const config = await deps.pairing.config(ws);
  if (!config.enabled) return null;
  const settings = await deps.directory.settings(ws);
  const round = pairingRoundOf(config.cadence, now, settings.timezone);
  return { type: "RunPairingRound", key: pairingKey(ws, round), workspaceId: ws, actor: { kind: "system", job: "pairing" }, at: now, round, seed: `${ws}:${round}` };
}
