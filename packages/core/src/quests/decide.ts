// S64-S67: pure quest deciders. Invariants from docs/statecharts/quest/Quest.tla:
// PaidOnlyForApprovals, CapRespected, NoSubmissionOutsideWindow, NothingPendingWithoutApprovalStep.
import type { NewEntry } from "../ledger/entries.ts";
import { canApprove, type MemberRecord } from "../members/members.ts";
import { fail, isAdminOrSystem, ok, type ModuleDecision } from "../rules/module-decision.ts";
import type { Instant, MemberId } from "../shared/types.ts";
import { isPosInt } from "../shared/types.ts";
import type {
  CloseQuest,
  CommentQuest,
  DefineQuest,
  PublishQuest,
  Quest,
  QuestEvent,
  QuestState,
  QuestWrite,
  ReviewSubmission,
  Submission,
  SubmissionResult,
  SubmitQuest,
} from "./types.ts";

export type QuestDecision<T> = ModuleDecision<T, QuestEvent, QuestWrite>;

const SUBMITTERS = ["self", "nomination", "both"] as const;

/** S64: an admin creates or edits a quest. A new quest starts as a draft; an edit keeps the state. */
export function decideDefineQuest(s: { readonly existing: Quest | null }, cmd: DefineQuest, _now: Instant): QuestDecision<{ questId: string; state: QuestState }> {
  if (!isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  const q = cmd.quest;
  if (q.id.trim() === "") return fail({ code: "invalid_field", field: "id" });
  if (q.title.trim() === "") return fail({ code: "invalid_field", field: "title" });
  if (q.reward.mode === "fixed" && !isPosInt(q.reward.amount)) return fail({ code: "invalid_field", field: "reward.amount" });
  if (q.reward.mode === "approver_choice" && !q.approvalRequired) return fail({ code: "invalid_field", field: "reward.mode" });
  if (!SUBMITTERS.includes(q.submitters)) return fail({ code: "invalid_field", field: "submitters" });
  if (q.perSubmitterCap !== null && !isPosInt(q.perSubmitterCap)) return fail({ code: "invalid_field", field: "perSubmitterCap" });
  if (q.teamCap !== null && !isPosInt(q.teamCap)) return fail({ code: "invalid_field", field: "teamCap" });
  if (!Number.isSafeInteger(q.cooldownMs) || q.cooldownMs < 0) return fail({ code: "invalid_field", field: "cooldownMs" });
  if (q.opensAt !== null && q.closesAt !== null && q.closesAt <= q.opensAt) return fail({ code: "invalid_field", field: "closesAt" });
  const quest: Quest = { ...q, state: s.existing?.state ?? "draft" };
  return ok({ questId: quest.id, state: quest.state }, { writes: [{ t: "quest.upsert", quest }] });
}

function transition(quest: Quest | null, actor: DefineQuest["actor"], from: QuestState, to: QuestState): QuestDecision<{ questId: string; state: QuestState }> {
  if (!isAdminOrSystem(actor)) return fail({ code: "forbidden", need: "admin" });
  if (quest === null) return fail({ code: "not_found", what: "quest" });
  if (quest.state !== from) return fail({ code: "invalid_transition", from: quest.state, to });
  const next: Quest = { ...quest, state: to };
  const event: QuestEvent = to === "open" ? { type: "quest.opened", questId: quest.id } : { type: "quest.closed", questId: quest.id };
  return ok({ questId: quest.id, state: to }, { writes: [{ t: "quest.upsert", quest: next }], events: [event] });
}

/** S65: draft -> open. */
export const decidePublishQuest = (s: { readonly quest: Quest | null }, cmd: PublishQuest, _now: Instant) => transition(s.quest, cmd.actor, "draft", "open");

/** S65: open -> closed. Pending submissions can still be reviewed afterwards. */
export const decideCloseQuest = (s: { readonly quest: Quest | null }, cmd: CloseQuest, _now: Instant) => transition(s.quest, cmd.actor, "open", "closed");

export interface SubmitSnapshot {
  readonly quest: Quest | null;
  /** Every submission of this quest (all members). */
  readonly submissions: readonly Submission[];
  /** The member who completed the quest (cmd.memberId). */
  readonly member: MemberRecord | null;
  readonly newSubmissionId: string;
}

const approvedCount = (subs: readonly Submission[], member?: MemberId) =>
  subs.filter((x) => x.state === "approved" && (member === undefined || x.memberId === member)).length;

/** CapRespected: per-member and team caps count approved submissions. */
function capError(quest: Quest, subs: readonly Submission[], member: MemberId): ReturnType<typeof fail> | null {
  if (quest.perSubmitterCap !== null && approvedCount(subs, member) >= quest.perSubmitterCap) return fail({ code: "cap_reached", cap: "member" });
  if (quest.teamCap !== null && approvedCount(subs) >= quest.teamCap) return fail({ code: "cap_reached", cap: "team" });
  return null;
}

/** The fixed reward, or the approver's chosen amount; null when one is required but missing. */
function rewardFor(quest: Quest, chosen: number | null): number | null {
  switch (quest.reward.mode) {
    case "fixed":
      return quest.reward.amount;
    case "approver_choice":
      return chosen !== null && isPosInt(chosen) ? chosen : null;
    case "recognition":
      return 0;
  }
}

/** S67: an approved submission pays a quest_reward entry (redeemable only); recognition pays nothing. */
function approve(quest: Quest, sub: Submission, amount: number, reviewer: MemberId | null, now: Instant, extra: QuestEvent[]): QuestDecision<SubmissionResult> {
  const approved: Submission = { ...sub, state: "approved", reward: amount, ...(reviewer === null ? {} : { reviewedBy: reviewer, reviewedAt: now }) };
  const entries: NewEntry[] = isPosInt(amount)
    ? [{ kind: "quest_reward", amount, memberId: sub.memberId, counterpartId: null, cause: { type: "quest", submissionId: sub.id }, source: null, allowanceDay: null, reason: quest.title }]
    : [];
  return ok(
    { submissionId: sub.id, state: "approved", reward: amount },
    {
      entries,
      writes: [{ t: "submission.upsert", submission: approved }],
      events: [...extra, { type: "quest.approved", questId: quest.id, submissionId: sub.id, memberId: sub.memberId, amount }],
    },
  );
}

/** S64-S66, S68: a member (or an event trigger) submits a quest completion. */
export function decideSubmitQuest(s: SubmitSnapshot, cmd: SubmitQuest, now: Instant): QuestDecision<SubmissionResult> {
  const quest = s.quest;
  if (quest === null) return fail({ code: "not_found", what: "quest" });
  // S65, NoSubmissionOutsideWindow
  if (quest.state !== "open") return fail({ code: "quest_not_open" });
  if ((quest.opensAt !== null && now < quest.opensAt) || (quest.closesAt !== null && now >= quest.closesAt)) return fail({ code: "outside_window" });

  // S64 who submits; S68 the system submits only for triggered quests.
  let submittedBy: MemberId | null;
  if (cmd.actor.kind === "system") {
    if (quest.trigger === null) return fail({ code: "forbidden", need: "member" });
    submittedBy = null;
  } else if (cmd.actor.kind === "member") {
    const self = cmd.actor.memberId === cmd.memberId;
    if ((quest.submitters === "self" && !self) || (quest.submitters === "nomination" && self)) return fail({ code: "submitter_not_allowed", allowed: quest.submitters });
    submittedBy = cmd.actor.memberId;
  } else {
    return fail({ code: "forbidden", need: "member" });
  }

  if (s.member === null) return fail({ code: "not_found", what: "member" });
  if (!s.member.active) return fail({ code: "inactive_member" });
  if (quest.proofRequired && submittedBy !== null && (cmd.proof ?? "").trim() === "") return fail({ code: "proof_required" });

  const mine = s.submissions.filter((x) => x.memberId === cmd.memberId);
  if (mine.some((x) => x.state === "pending")) return fail({ code: "submission_pending" });
  const capped = capError(quest, s.submissions, cmd.memberId);
  if (capped) return capped;
  // S66: a rejected submitter may resubmit, subject to cooldown.
  const last = mine.reduce<Instant | null>((t, x) => (t === null || x.submittedAt > t ? x.submittedAt : t), null);
  if (quest.cooldownMs > 0 && last !== null && now < last + quest.cooldownMs) return fail({ code: "cooldown", until: (last + quest.cooldownMs) as Instant });

  const sub: Submission = {
    id: s.newSubmissionId,
    questId: quest.id,
    memberId: cmd.memberId,
    submittedBy,
    proof: cmd.proof,
    note: cmd.note,
    state: "pending",
    submittedAt: now,
    reviewedBy: null,
    reviewedAt: null,
    reward: 0,
  };
  const submitted = (state: Submission["state"]): QuestEvent => ({ type: "quest.submitted", questId: quest.id, submissionId: sub.id, memberId: sub.memberId, submittedBy, state });

  // S66: without required approval, a submission is approved on submit (NothingPendingWithoutApprovalStep).
  if (!quest.approvalRequired) {
    const amount = rewardFor(quest, null);
    if (amount === null) return fail({ code: "amount_required" }); // unreachable: define refuses approver_choice without approval
    return approve(quest, sub, amount, null, now, [submitted("approved")]);
  }
  return ok({ submissionId: sub.id, state: "pending", reward: 0 }, { writes: [{ t: "submission.upsert", submission: sub }], events: [submitted("pending")] });
}

export interface ReviewSnapshot {
  readonly quest: Quest | null;
  readonly submission: Submission | null;
  /** Every submission of the quest, for the caps. */
  readonly submissions: readonly Submission[];
}

/** S66: an approver approves or rejects a pending submission, also after the quest closed (S65). */
export function decideReviewSubmission(s: ReviewSnapshot, cmd: ReviewSubmission, now: Instant): QuestDecision<SubmissionResult> {
  if (!canApprove(cmd.actor) || cmd.actor.kind !== "member") return fail({ code: "forbidden", need: "approver" });
  const reviewer = cmd.actor.memberId;
  const sub = s.submission;
  if (sub === null) return fail({ code: "not_found", what: "submission" });
  const quest = s.quest;
  if (quest === null) return fail({ code: "not_found", what: "quest" });
  const to = cmd.verdict === "approve" ? "approved" : "rejected";
  if (sub.state !== "pending") return fail({ code: "invalid_transition", from: sub.state, to });

  if (cmd.verdict === "reject") {
    const rejected: Submission = { ...sub, state: "rejected", reviewedBy: reviewer, reviewedAt: now, note: cmd.note ?? sub.note };
    return ok(
      { submissionId: sub.id, state: "rejected", reward: 0 },
      { writes: [{ t: "submission.upsert", submission: rejected }], events: [{ type: "quest.rejected", questId: quest.id, submissionId: sub.id, memberId: sub.memberId }] },
    );
  }
  const capped = capError(quest, s.submissions.filter((x) => x.id !== sub.id), sub.memberId);
  if (capped) return capped;
  const amount = rewardFor(quest, cmd.amount);
  if (amount === null) return fail({ code: "amount_required" });
  return approve(quest, sub, amount, reviewer, now, []);
}

/** S64: comments on the public timeline, only when it is on. */
export function decideCommentQuest(s: { readonly quest: Quest | null; readonly submission: Submission | null }, cmd: CommentQuest, now: Instant): QuestDecision<{ submissionId: string }> {
  if (cmd.actor.kind !== "member") return fail({ code: "forbidden", need: "member" });
  if (s.submission === null) return fail({ code: "not_found", what: "submission" });
  if (s.quest === null) return fail({ code: "not_found", what: "quest" });
  if (!s.quest.timeline) return fail({ code: "timeline_disabled" });
  if (cmd.text.trim() === "") return fail({ code: "invalid_field", field: "text" });
  const comment = { submissionId: s.submission.id, questId: s.quest.id, by: cmd.actor.memberId, text: cmd.text, at: now };
  return ok(
    { submissionId: s.submission.id },
    { writes: [{ t: "quest.comment", comment }], events: [{ type: "quest.commented", questId: s.quest.id, submissionId: s.submission.id, by: cmd.actor.memberId }] },
  );
}
