// S64-S68: quests and submissions (docs/statecharts/quest).
import type { CommandBase, Instant, MemberId, PosInt, WorkspaceId } from "../shared/types.ts";

export type QuestReward =
  | { readonly mode: "fixed"; readonly amount: PosInt }
  | { readonly mode: "approver_choice" }
  | { readonly mode: "recognition" };

export type SubmitterMode = "self" | "nomination" | "both";
export type QuestState = "draft" | "open" | "closed";
export type SubmissionState = "pending" | "approved" | "rejected";

/** S68: completion triggered by a domain event, e.g. "first gift given" = gift.given for the giver with cap 1. */
export interface QuestTrigger {
  readonly event: "gift.given";
  readonly who: "giver" | "receiver";
}

export interface Quest {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly image: string | null;
  readonly reward: QuestReward;
  readonly submitters: SubmitterMode;
  readonly proofRequired: boolean;
  readonly approvalRequired: boolean;
  /** Public timeline with comments. */
  readonly timeline: boolean;
  /** Max approved submissions per member; null = unlimited. */
  readonly perSubmitterCap: PosInt | null;
  /** Max approved submissions across the team; null = unlimited. */
  readonly teamCap: PosInt | null;
  /** Minimum time between two submissions of the same member; 0 = none. */
  readonly cooldownMs: number;
  readonly opensAt: Instant | null;
  /** Exclusive: submissions at or after this instant are outside the window. */
  readonly closesAt: Instant | null;
  readonly state: QuestState;
  readonly trigger: QuestTrigger | null;
}

export type QuestInput = Omit<Quest, "state">;

export interface Submission {
  readonly id: string;
  readonly questId: string;
  /** Who completed the quest and gets the reward (the nominee for nominations). */
  readonly memberId: MemberId;
  /** Who submitted it; null for an event-triggered submission (S68). */
  readonly submittedBy: MemberId | null;
  readonly proof: string | null;
  readonly note: string | null;
  readonly state: SubmissionState;
  readonly submittedAt: Instant;
  readonly reviewedBy: MemberId | null;
  readonly reviewedAt: Instant | null;
  /** Units paid; 0 until approved, and for recognition-only quests. */
  readonly reward: number;
}

export interface QuestComment {
  readonly submissionId: string;
  readonly questId: string;
  readonly by: MemberId;
  readonly text: string;
  readonly at: Instant;
}

// ───────────── Commands ─────────────

export interface DefineQuest extends CommandBase {
  readonly type: "DefineQuest";
  readonly quest: QuestInput;
}
export interface PublishQuest extends CommandBase {
  readonly type: "PublishQuest";
  readonly questId: string;
}
export interface CloseQuest extends CommandBase {
  readonly type: "CloseQuest";
  readonly questId: string;
}
export interface SubmitQuest extends CommandBase {
  readonly type: "SubmitQuest";
  readonly questId: string;
  /** Who completed it: the actor for self-submissions, the nominee for nominations. */
  readonly memberId: MemberId;
  readonly proof: string | null;
  readonly note: string | null;
}
export interface ReviewSubmission extends CommandBase {
  readonly type: "ReviewSubmission";
  readonly submissionId: string;
  readonly verdict: "approve" | "reject";
  /** Required for approver's-choice quests. */
  readonly amount: PosInt | null;
  readonly note: string | null;
}
export interface CommentQuest extends CommandBase {
  readonly type: "CommentQuest";
  readonly submissionId: string;
  readonly text: string;
}

export type QuestCommand = DefineQuest | PublishQuest | CloseQuest | SubmitQuest | ReviewSubmission | CommentQuest;

export interface SubmissionResult {
  readonly submissionId: string;
  readonly state: SubmissionState;
  readonly reward: number;
}

// ───────────── Events and writes ─────────────

export type QuestEvent =
  | { readonly type: "quest.opened"; readonly questId: string }
  | { readonly type: "quest.closed"; readonly questId: string }
  | {
      readonly type: "quest.submitted";
      readonly questId: string;
      readonly submissionId: string;
      readonly memberId: MemberId;
      readonly submittedBy: MemberId | null;
      readonly state: SubmissionState;
    }
  | { readonly type: "quest.approved"; readonly questId: string; readonly submissionId: string; readonly memberId: MemberId; readonly amount: number }
  | { readonly type: "quest.rejected"; readonly questId: string; readonly submissionId: string; readonly memberId: MemberId }
  | { readonly type: "quest.commented"; readonly questId: string; readonly submissionId: string; readonly by: MemberId };

export type QuestWrite =
  | { readonly t: "quest.upsert"; readonly quest: Quest }
  | { readonly t: "submission.upsert"; readonly submission: Submission }
  | { readonly t: "quest.comment"; readonly comment: QuestComment };

/** Read port for quests (implemented by packages/db and the in-memory fake). */
export interface QuestStore {
  quest(ws: WorkspaceId, id: string): Promise<Quest | null>;
  quests(ws: WorkspaceId): Promise<readonly Quest[]>;
  submission(ws: WorkspaceId, id: string): Promise<Submission | null>;
  submissions(ws: WorkspaceId, questId: string): Promise<readonly Submission[]>;
  comments(ws: WorkspaceId, submissionId: string): Promise<readonly QuestComment[]>;
}
