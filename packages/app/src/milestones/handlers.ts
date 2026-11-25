// Celebrations (S92-S94). The celebration key is one per member, kind and date, so a missed
// scheduler tick, a restart or two replicas never post or pay twice.
import type { CommandKey, Decision, Directory, Instant, LocalDate, MemberId, MemberRecord, WorkspaceId } from "@propi/core";
import { defineHandler } from "../handler.ts";
import { activeMembers } from "../rules/handlers.ts";
import type { ModuleDecision } from "../rules/core.ts";
import {
  celebrationTime,
  celebrationsDue,
  decideCelebrateMilestone,
  decideConfigureMilestones,
  decideSetMilestones,
  milestoneKey,
  type CelebrateMilestone,
  type CelebrateSnapshot,
  type ConfigureMilestones,
  type MilestoneConfig,
  type MilestoneKind,
  type MilestoneProfile,
  type MilestoneStore,
  type SetMilestones,
} from "./core.ts";

export interface MilestoneDeps {
  readonly milestones: MilestoneStore;
}

export type MilestoneResults = {
  SetMilestones: MilestoneProfile;
  ConfigureMilestones: MilestoneConfig;
  CelebrateMilestone: { memberId: MemberId; kind: MilestoneKind; date: LocalDate; bonus: number };
};

const widen = <T>(d: ModuleDecision<T, unknown, unknown>): Decision<T> => d as unknown as Decision<T>;

export function milestoneHandlers(deps: MilestoneDeps) {
  return [
    defineHandler<SetMilestones, { member: MemberRecord | null }, MilestoneResults["SetMilestones"]>({
      type: "SetMilestones",
      locks: () => [],
      load: async (cmd, _tx, ctx) => ({ member: await ctx.directory.member(cmd.workspaceId, cmd.memberId) }),
      decide: (s, cmd, now) => widen(decideSetMilestones(s, cmd, now)),
    }),

    defineHandler<ConfigureMilestones, null, MilestoneResults["ConfigureMilestones"]>({
      type: "ConfigureMilestones",
      locks: () => [],
      load: async () => null,
      decide: (_s, cmd, now) => widen(decideConfigureMilestones(cmd, now)),
    }),

    defineHandler<CelebrateMilestone, CelebrateSnapshot, MilestoneResults["CelebrateMilestone"]>({
      type: "CelebrateMilestone",
      // A bonus only credits, so no balance lock; the key is the guard.
      locks: () => [],
      // One key per member, kind and date, used only once the celebration is due (an early attempt cannot consume it).
      async resolveKey(cmd, _tx, ctx) {
        const key = milestoneKey(cmd.memberId, cmd.kind, cmd.date);
        const due = celebrationTime(await deps.milestones.config(cmd.workspaceId), cmd.date, ctx.settings.timezone);
        return ctx.now >= due ? key : (`${key}:early` as CommandKey);
      },
      load: async (cmd, _tx, ctx) => ({
        settings: ctx.settings,
        config: await deps.milestones.config(cmd.workspaceId),
        profile: await deps.milestones.profile(cmd.workspaceId, cmd.memberId),
        member: await ctx.directory.member(cmd.workspaceId, cmd.memberId),
      }),
      decide: (s, cmd, now) => widen(decideCelebrateMilestone(s, cmd, now)),
    }),
  ];
}

/** S93: the celebrations the scheduler should execute now. */
export async function dueCelebrations(deps: MilestoneDeps & { readonly directory: Directory }, ws: WorkspaceId, now: Instant): Promise<CelebrateMilestone[]> {
  const settings = await deps.directory.settings(ws);
  return celebrationsDue(await deps.milestones.profiles(ws), await activeMembers(deps.directory, ws), await deps.milestones.config(ws), now, settings.timezone, ws);
}
