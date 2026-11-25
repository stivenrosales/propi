// Levels and avatars (S77-S79). Levels are computed on read from the ledger, never stored (S78).
import type { Decision, MemberId, Reader, WorkspaceId } from "@propi/core";
import { defineHandler } from "../handler.ts";
import type { ModuleDecision } from "../rules/core.ts";
import {
  decideChooseAvatar,
  decideConfigureLevels,
  levelOf,
  unlockedAvatars,
  type Avatar,
  type ChooseAvatar,
  type ChooseAvatarSnapshot,
  type ConfigureLevels,
  type LevelConfig,
  type LevelStore,
  type MemberLevel,
} from "./core.ts";

export interface LevelDeps {
  readonly reader: Reader;
  readonly levels: LevelStore;
}

export type LevelResults = {
  ConfigureLevels: LevelConfig;
  ChooseAvatar: { avatarId: string; level: number };
};

const widen = <T>(d: ModuleDecision<T, unknown, unknown>): Decision<T> => d as unknown as Decision<T>;

export function levelHandlers(deps: LevelDeps) {
  return [
    defineHandler<ConfigureLevels, null, LevelResults["ConfigureLevels"]>({
      type: "ConfigureLevels",
      locks: () => [],
      load: async () => null,
      decide: (_s, cmd, now) => widen(decideConfigureLevels(cmd, now)),
    }),

    defineHandler<ChooseAvatar, ChooseAvatarSnapshot, LevelResults["ChooseAvatar"]>({
      type: "ChooseAvatar",
      locks: () => [],
      async load(cmd, tx) {
        const config = await deps.levels.config(cmd.workspaceId);
        const balances = cmd.actor.kind === "member" ? await tx.balances(cmd.actor.memberId) : { received: 0, given: 0, redeemable: 0 };
        return { ...config, balances };
      },
      decide: (s, cmd, now) => widen(decideChooseAvatar(s, cmd, now)),
    }),
  ];
}

export interface MemberLevelView extends MemberLevel {
  readonly avatarId: string | null;
  readonly unlockedAvatars: readonly Avatar[];
}

/** S77-S79: a member's level, folded from their balances on every read. */
export async function memberLevel(deps: LevelDeps, ws: WorkspaceId, member: MemberId): Promise<MemberLevelView> {
  const config = await deps.levels.config(ws);
  const level = levelOf(await deps.reader.workspace(ws).balances(member), config.table);
  return { ...level, avatarId: await deps.levels.avatar(ws, member), unlockedAvatars: unlockedAvatars(level.level, config.avatars) };
}
