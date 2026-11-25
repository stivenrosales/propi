// Quest use cases (S64-S68). Every quest command serializes on the quest aggregate lock, so caps,
// cooldowns and the pending -> approved/rejected compare-and-set hold under concurrency.
import type { CommandKey, Decision, Instant, LockKey, WorkspaceId } from "@propi/core";
import { defineHandler } from "../handler.ts";
import type { ModuleDecision } from "../rules/core.ts";
import {
  decideCloseQuest,
  decideCommentQuest,
  decideDefineQuest,
  decidePublishQuest,
  decideReviewSubmission,
  decideSubmitQuest,
  questSubmissionsFor,
  type CloseQuest,
  type CommentQuest,
  type DefineQuest,
  type PublishQuest,
  type Quest,
  type QuestState,
  type QuestStore,
  type ReviewSnapshot,
  type ReviewSubmission,
  type Submission,
  type SubmissionResult,
  type SubmitQuest,
  type SubmitSnapshot,
} from "./core.ts";

export interface QuestDeps {
  readonly quests: QuestStore;
}

export type QuestResults = {
  DefineQuest: { questId: string; state: QuestState };
  PublishQuest: { questId: string; state: QuestState };
  CloseQuest: { questId: string; state: QuestState };
  SubmitQuest: SubmissionResult;
  ReviewSubmission: SubmissionResult;
  CommentQuest: { submissionId: string };
};

const widen = <T>(d: ModuleDecision<T, unknown, unknown>): Decision<T> => d as unknown as Decision<T>;

/**
 * G4 aggregate lock for a quest. `quest:` is not yet a LockKey prefix: until shared/locks.ts adds it
 * (rank 0, with gift/redemption/collab) it sorts after member keys, which is still one global order.
 */
export const questLock = (questId: string): LockKey => `quest:${questId}`;

export function questHandlers(deps: QuestDeps) {
  const quest = (ws: WorkspaceId, id: string) => deps.quests.quest(ws, id);
  return [
    defineHandler<DefineQuest, { existing: Quest | null }, QuestResults["DefineQuest"]>({
      type: "DefineQuest",
      locks: (cmd) => [questLock(cmd.quest.id)],
      load: async (cmd) => ({ existing: await quest(cmd.workspaceId, cmd.quest.id) }),
      decide: (s, cmd, now) => widen(decideDefineQuest(s, cmd, now)),
    }),

    defineHandler<PublishQuest, { quest: Quest | null }, QuestResults["PublishQuest"]>({
      type: "PublishQuest",
      locks: (cmd) => [questLock(cmd.questId)],
      load: async (cmd) => ({ quest: await quest(cmd.workspaceId, cmd.questId) }),
      decide: (s, cmd, now) => widen(decidePublishQuest(s, cmd, now)),
    }),

    defineHandler<CloseQuest, { quest: Quest | null }, QuestResults["CloseQuest"]>({
      type: "CloseQuest",
      locks: (cmd) => [questLock(cmd.questId)],
      load: async (cmd) => ({ quest: await quest(cmd.workspaceId, cmd.questId) }),
      decide: (s, cmd, now) => widen(decideCloseQuest(s, cmd, now)),
    }),

    defineHandler<SubmitQuest, SubmitSnapshot, QuestResults["SubmitQuest"]>({
      type: "SubmitQuest",
      locks: (cmd) => [questLock(cmd.questId)],
      load: async (cmd, _tx, ctx) => ({
        quest: await quest(cmd.workspaceId, cmd.questId),
        submissions: await deps.quests.submissions(cmd.workspaceId, cmd.questId),
        member: await ctx.directory.member(cmd.workspaceId, cmd.memberId),
        newSubmissionId: ctx.ids.next("submission"),
      }),
      decide: (s, cmd, now) => widen(decideSubmitQuest(s, cmd, now)),
    }),

    defineHandler<ReviewSubmission, ReviewSnapshot, QuestResults["ReviewSubmission"]>({
      type: "ReviewSubmission",
      async locks(cmd) {
        const sub = await deps.quests.submission(cmd.workspaceId, cmd.submissionId);
        return [questLock(sub?.questId ?? `?${cmd.submissionId}`)];
      },
      async load(cmd) {
        const submission: Submission | null = await deps.quests.submission(cmd.workspaceId, cmd.submissionId);
        if (submission === null) return { quest: null, submission, submissions: [] };
        return { quest: await quest(cmd.workspaceId, submission.questId), submission, submissions: await deps.quests.submissions(cmd.workspaceId, submission.questId) };
      },
      decide: (s, cmd, now) => widen(decideReviewSubmission(s, cmd, now)),
    }),

    defineHandler<CommentQuest, { quest: Quest | null; submission: Submission | null }, QuestResults["CommentQuest"]>({
      type: "CommentQuest",
      locks: () => [],
      async load(cmd) {
        const submission = await deps.quests.submission(cmd.workspaceId, cmd.submissionId);
        return { submission, quest: submission === null ? null : await quest(cmd.workspaceId, submission.questId) };
      },
      decide: (s, cmd, now) => widen(decideCommentQuest(s, cmd, now)),
    }),
  ];
}

/** S68: the relay calls this for each committed event; executing the commands is idempotent by key. */
export async function questCommandsForEvent(
  deps: QuestDeps,
  row: { readonly workspaceId: WorkspaceId; readonly commandKey: CommandKey; readonly at: Instant; readonly event: { readonly type: string } },
): Promise<SubmitQuest[]> {
  return questSubmissionsFor(await deps.quests.quests(row.workspaceId), row);
}
