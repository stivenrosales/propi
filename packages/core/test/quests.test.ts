import { describe, expect, test } from "vitest";
import type { Instant, MemberId, PosInt } from "../src/index.ts";
import {
  decideCloseQuest,
  decideCommentQuest,
  decideDefineQuest,
  decidePublishQuest,
  decideReviewSubmission,
  decideSubmitQuest,
  questSubmissionsFor,
  type Quest,
  type QuestInput,
  type ReviewSubmission,
  type Submission,
  type SubmitQuest,
  type SubmitSnapshot,
} from "../src/quests/index.ts";
import { NOON_LIMA, WS, key, m, memberActor } from "./fixtures.ts";

const p = (n: number) => n as PosInt;
const HOUR = 3_600_000;
const NOW = NOON_LIMA;
const admin = memberActor("boss", "admin");
const approver = memberActor("appr", "approver");

const quest = (over: Partial<Quest> = {}): Quest => ({
  id: "q1",
  title: "Run a demo",
  description: "Show the team something new",
  image: null,
  reward: { mode: "fixed", amount: p(5) },
  submitters: "both",
  proofRequired: false,
  approvalRequired: true,
  timeline: true,
  perSubmitterCap: null,
  teamCap: null,
  cooldownMs: 0,
  opensAt: null,
  closesAt: null,
  state: "open",
  trigger: null,
  ...over,
});

const sub = (over: Partial<Submission> = {}): Submission => ({
  id: "s0",
  questId: "q1",
  memberId: m("ana"),
  submittedBy: m("ana"),
  proof: null,
  note: null,
  state: "approved",
  submittedAt: (NOW - 48 * HOUR) as Instant,
  reviewedBy: null,
  reviewedAt: null,
  reward: 5,
  ...over,
});

const submit = (over: Partial<SubmitQuest> = {}): SubmitQuest => ({
  type: "SubmitQuest",
  key: key("web:submit:1"),
  workspaceId: WS,
  actor: memberActor("ana"),
  at: NOW,
  questId: "q1",
  memberId: m("ana"),
  proof: null,
  note: null,
  ...over,
});

const snap = (over: Partial<SubmitSnapshot> = {}): SubmitSnapshot => ({
  quest: quest(),
  submissions: [],
  member: { id: m("ana"), role: "member", active: true, dailyLimitOverride: null },
  newSubmissionId: "s-new",
  ...over,
});

const review = (verdict: "approve" | "reject", over: Partial<ReviewSubmission> = {}): ReviewSubmission => ({
  type: "ReviewSubmission",
  key: key("web:review:1"),
  workspaceId: WS,
  actor: approver,
  at: NOW,
  submissionId: "s1",
  verdict,
  amount: null,
  note: null,
  ...over,
});

const err = (d: { outcome: { ok: boolean } }) => (d.outcome as { error?: unknown }).error;

describe("quests", () => {
  test("S64: an admin creates a quest with reward mode, submitters, proof, approval, timeline, caps, cooldown and window", () => {
    const input: QuestInput = {
      id: "q1",
      title: "Run a demo",
      description: "Show the team something new",
      image: "https://img/q1.png",
      reward: { mode: "approver_choice" },
      submitters: "nomination",
      proofRequired: true,
      approvalRequired: true,
      timeline: false,
      perSubmitterCap: p(1),
      teamCap: p(10),
      cooldownMs: 24 * HOUR,
      opensAt: NOW,
      closesAt: (NOW + 7 * 24 * HOUR) as Instant,
      trigger: null,
    };
    const cmd = { type: "DefineQuest" as const, key: key("api:q1"), workspaceId: WS, actor: admin, at: NOW, quest: input };
    const d = decideDefineQuest({ existing: null }, cmd, NOW);
    expect(d.outcome).toEqual({ ok: true, value: { questId: "q1", state: "draft" } });
    expect(d.writes).toEqual([{ t: "quest.upsert", quest: { ...input, state: "draft" } }]);
    expect(err(decideDefineQuest({ existing: null }, { ...cmd, actor: memberActor("ana") }, NOW))).toEqual({ code: "forbidden", need: "admin" });
    // Approver's choice needs an approval step to choose the amount.
    expect(err(decideDefineQuest({ existing: null }, { ...cmd, quest: { ...input, approvalRequired: false } }, NOW))).toEqual({ code: "invalid_field", field: "reward.mode" });
    expect(err(decideDefineQuest({ existing: null }, { ...cmd, quest: { ...input, closesAt: NOW } }, NOW))).toEqual({ code: "invalid_field", field: "closesAt" });
  });

  test("S65: lifecycle draft -> open -> closed; other transitions are refused", () => {
    const base = { key: key("api:l"), workspaceId: WS, actor: admin, at: NOW, questId: "q1" };
    const opened = decidePublishQuest({ quest: quest({ state: "draft" }) }, { ...base, type: "PublishQuest" }, NOW);
    expect(opened.writes).toEqual([{ t: "quest.upsert", quest: quest({ state: "open" }) }]);
    expect(opened.events).toEqual([{ type: "quest.opened", questId: "q1" }]);
    expect(decideCloseQuest({ quest: quest() }, { ...base, type: "CloseQuest" }, NOW).writes).toEqual([{ t: "quest.upsert", quest: quest({ state: "closed" }) }]);
    expect(err(decidePublishQuest({ quest: quest({ state: "closed" }) }, { ...base, type: "PublishQuest" }, NOW))).toEqual({ code: "invalid_transition", from: "closed", to: "open" });
    expect(err(decideCloseQuest({ quest: quest({ state: "draft" }) }, { ...base, type: "CloseQuest" }, NOW))).toEqual({ code: "invalid_transition", from: "draft", to: "closed" });
  });

  test("S65: submissions are accepted only while open and within the window (Quest.tla NoSubmissionOutsideWindow)", () => {
    expect(err(decideSubmitQuest(snap({ quest: quest({ state: "draft" }) }), submit(), NOW))).toEqual({ code: "quest_not_open" });
    expect(err(decideSubmitQuest(snap({ quest: quest({ state: "closed" }) }), submit(), NOW))).toEqual({ code: "quest_not_open" });
    expect(err(decideSubmitQuest(snap({ quest: quest({ opensAt: (NOW + HOUR) as Instant }) }), submit(), NOW))).toEqual({ code: "outside_window" });
    expect(err(decideSubmitQuest(snap({ quest: quest({ closesAt: NOW }) }), submit(), NOW))).toEqual({ code: "outside_window" });
    expect(decideSubmitQuest(snap({ quest: quest({ closesAt: (NOW + 1) as Instant }) }), submit(), NOW).outcome.ok).toBe(true);
  });

  test("S64: who submits: self, nomination or both", () => {
    const nominate = submit({ actor: memberActor("bob"), memberId: m("ana") });
    expect(err(decideSubmitQuest(snap({ quest: quest({ submitters: "self" }) }), nominate, NOW))).toEqual({ code: "submitter_not_allowed", allowed: "self" });
    expect(err(decideSubmitQuest(snap({ quest: quest({ submitters: "nomination" }) }), submit(), NOW))).toEqual({ code: "submitter_not_allowed", allowed: "nomination" });
    const d = decideSubmitQuest(snap({ quest: quest({ submitters: "nomination" }) }), nominate, NOW);
    expect(d.writes[0]).toMatchObject({ t: "submission.upsert", submission: { memberId: "ana", submittedBy: "bob", state: "pending" } });
    expect(decideSubmitQuest(snap(), nominate, NOW).outcome.ok).toBe(true);
    expect(decideSubmitQuest(snap(), submit(), NOW).outcome.ok).toBe(true);
  });

  test("S64: proof required", () => {
    const q = quest({ proofRequired: true });
    expect(err(decideSubmitQuest(snap({ quest: q }), submit({ proof: "  " }), NOW))).toEqual({ code: "proof_required" });
    expect(decideSubmitQuest(snap({ quest: q }), submit({ proof: "https://demo" }), NOW).outcome.ok).toBe(true);
  });

  test("S66: with approval required a submission waits as pending and pays nothing yet (Quest.tla NothingPendingWithoutApprovalStep)", () => {
    const d = decideSubmitQuest(snap(), submit({ note: "did it" }), NOW);
    expect(d.outcome).toEqual({ ok: true, value: { submissionId: "s-new", state: "pending", reward: 0 } });
    expect(d.entries).toEqual([]);
    expect(d.events).toEqual([{ type: "quest.submitted", questId: "q1", submissionId: "s-new", memberId: "ana", submittedBy: "ana", state: "pending" }]);
  });

  test("S66, S67: without required approval a submission is approved on submit and paid as a quest_reward (redeemable only)", () => {
    const d = decideSubmitQuest(snap({ quest: quest({ approvalRequired: false }) }), submit(), NOW);
    expect(d.outcome).toEqual({ ok: true, value: { submissionId: "s-new", state: "approved", reward: 5 } });
    expect(d.entries).toEqual([
      { kind: "quest_reward", amount: 5, memberId: "ana", counterpartId: null, cause: { type: "quest", submissionId: "s-new" }, source: null, allowanceDay: null, reason: "Run a demo" },
    ]);
    expect(d.events.map((e) => e.type)).toEqual(["quest.submitted", "quest.approved"]);
  });

  test("S66: an approver approves (paid) or rejects (not paid) a pending submission, even after the quest closed (S65)", () => {
    const pending = sub({ id: "s1", state: "pending", reward: 0 });
    const closed = quest({ state: "closed" });
    const ok = decideReviewSubmission({ quest: closed, submission: pending, submissions: [pending] }, review("approve"), NOW);
    expect(ok.outcome).toEqual({ ok: true, value: { submissionId: "s1", state: "approved", reward: 5 } });
    expect(ok.entries.map((e) => [e.kind, e.memberId, e.amount])).toEqual([["quest_reward", "ana", 5]]);
    expect(ok.writes).toEqual([{ t: "submission.upsert", submission: { ...pending, state: "approved", reviewedBy: "appr", reviewedAt: NOW, reward: 5 } }]);
    const no = decideReviewSubmission({ quest: closed, submission: pending, submissions: [pending] }, review("reject", { note: "no proof" }), NOW);
    expect(no.entries).toEqual([]);
    expect(no.events).toEqual([{ type: "quest.rejected", questId: "q1", submissionId: "s1", memberId: "ana" }]);
    expect(err(decideReviewSubmission({ quest: closed, submission: pending, submissions: [] }, review("approve", { actor: memberActor("ana") }), NOW))).toEqual({
      code: "forbidden",
      need: "approver",
    });
    const done = sub({ id: "s1", state: "approved" });
    expect(err(decideReviewSubmission({ quest: closed, submission: done, submissions: [done] }, review("reject"), NOW))).toEqual({ code: "invalid_transition", from: "approved", to: "rejected" });
  });

  test("S64: reward modes: approver's choice needs an amount, recognition only pays nothing", () => {
    const pending = sub({ id: "s1", state: "pending", reward: 0 });
    const choice = quest({ reward: { mode: "approver_choice" } });
    expect(err(decideReviewSubmission({ quest: choice, submission: pending, submissions: [] }, review("approve"), NOW))).toEqual({ code: "amount_required" });
    expect(decideReviewSubmission({ quest: choice, submission: pending, submissions: [] }, review("approve", { amount: p(12) }), NOW).entries[0]?.amount).toBe(12);
    const fame = decideReviewSubmission({ quest: quest({ reward: { mode: "recognition" } }), submission: pending, submissions: [] }, review("approve"), NOW);
    expect(fame.outcome).toEqual({ ok: true, value: { submissionId: "s1", state: "approved", reward: 0 } });
    expect(fame.entries).toEqual([]);
  });

  test("S66: a rejected submitter may resubmit, subject to cooldown; a pending one may not submit again", () => {
    const q = quest({ cooldownMs: 24 * HOUR });
    const rejectedRecently = sub({ state: "rejected", submittedAt: (NOW - HOUR) as Instant });
    expect(err(decideSubmitQuest(snap({ quest: q, submissions: [rejectedRecently] }), submit(), NOW))).toEqual({ code: "cooldown", until: NOW + 23 * HOUR });
    const rejectedLongAgo = sub({ state: "rejected", submittedAt: (NOW - 25 * HOUR) as Instant });
    expect(decideSubmitQuest(snap({ quest: q, submissions: [rejectedLongAgo] }), submit(), NOW).outcome.ok).toBe(true);
    expect(err(decideSubmitQuest(snap({ submissions: [sub({ state: "pending" })] }), submit(), NOW))).toEqual({ code: "submission_pending" });
  });

  test("S64: per-submitter and team caps hold on submit and on approval (Quest.tla CapRespected)", () => {
    const one = quest({ perSubmitterCap: p(1) });
    expect(err(decideSubmitQuest(snap({ quest: one, submissions: [sub()] }), submit(), NOW))).toEqual({ code: "cap_reached", cap: "member" });
    const team = quest({ teamCap: p(1) });
    expect(err(decideSubmitQuest(snap({ quest: team, submissions: [sub({ memberId: m("bob") })] }), submit(), NOW))).toEqual({ code: "cap_reached", cap: "team" });
    // Two pending submissions under a team cap of 1: only the first approval pays.
    const a = sub({ id: "s1", state: "pending", reward: 0 });
    const b = sub({ id: "s2", memberId: m("bob"), state: "pending", reward: 0 });
    const first = decideReviewSubmission({ quest: team, submission: a, submissions: [a, b] }, review("approve"), NOW);
    expect(first.entries).toHaveLength(1);
    const approvedA = { ...a, state: "approved" as const };
    const second = decideReviewSubmission({ quest: team, submission: b, submissions: [approvedA, b] }, review("approve", { submissionId: "s2" }), NOW);
    expect(err(second)).toEqual({ code: "cap_reached", cap: "team" });
    expect(second.entries).toEqual([]);
  });

  test("S64: the public timeline accepts comments only when it is on", () => {
    const s1 = sub({ id: "s1" });
    const c = { type: "CommentQuest" as const, key: key("web:c1"), workspaceId: WS, actor: memberActor("bob"), at: NOW, submissionId: "s1", text: "great demo" };
    const d = decideCommentQuest({ quest: quest(), submission: s1 }, c, NOW);
    expect(d.writes).toEqual([{ t: "quest.comment", comment: { submissionId: "s1", questId: "q1", by: "bob", text: "great demo", at: NOW } }]);
    expect(err(decideCommentQuest({ quest: quest({ timeline: false }), submission: s1 }, c, NOW))).toEqual({ code: "timeline_disabled" });
  });

  test("S68: domain events map to SubmitQuest commands for open quests with a matching trigger", () => {
    const firstGift = quest({ id: "first-gift", trigger: { event: "gift.given", who: "giver" }, perSubmitterCap: p(1), approvalRequired: false });
    const received = quest({ id: "got-one", trigger: { event: "gift.given", who: "receiver" }, approvalRequired: false });
    const quests = [firstGift, received, quest({ id: "manual" }), quest({ id: "draft", state: "draft", trigger: { event: "gift.given", who: "giver" } })];
    const event = { type: "gift.given", giftId: "g1", giver: m("ana"), receivers: [m("bob"), m("cy")], perReceiver: 1, totalCost: 2, remainingAllowance: 3, source: "message" };
    const cmds = questSubmissionsFor(quests, { workspaceId: WS, commandKey: key("slack:msg:T:C1:1"), at: NOW, event });
    expect(cmds.map((c) => [c.key, c.questId, c.memberId, c.actor.kind])).toEqual([
      ["quest:first-gift:auto:ana:slack:msg:T:C1:1", "first-gift", "ana", "system"],
      ["quest:got-one:auto:bob:slack:msg:T:C1:1", "got-one", "bob", "system"],
      ["quest:got-one:auto:cy:slack:msg:T:C1:1", "got-one", "cy", "system"],
    ]);
    expect(questSubmissionsFor(quests, { workspaceId: WS, commandKey: key("k"), at: NOW, event: { type: "adjustment.made" } })).toEqual([]);
    // A triggered submission is accepted from the system actor without proof; the cap makes "first gift" pay once.
    const auto = cmds[0]!;
    const paid = decideSubmitQuest(snap({ quest: { ...firstGift, proofRequired: true } }), auto, NOW);
    expect(paid.entries.map((e) => e.kind)).toEqual(["quest_reward"]);
    const again = decideSubmitQuest(snap({ quest: firstGift, submissions: [sub({ questId: "first-gift" })] }), auto, NOW);
    expect(err(again)).toEqual({ code: "cap_reached", cap: "member" });
    // The system actor cannot submit to a quest without a trigger.
    expect(err(decideSubmitQuest(snap(), { ...auto, questId: "q1" }, NOW))).toEqual({ code: "forbidden", need: "member" });
  });

  test("S67: across any sequence, quest_reward units equal reward x approvals (Quest.tla PaidOnlyForApprovals)", () => {
    const q = quest({ teamCap: p(2) });
    let submissions: Submission[] = [];
    let paid = 0;
    let approvals = 0;
    const members: MemberId[] = [m("ana"), m("bob"), m("cy")];
    for (const [i, who] of members.entries()) {
      const s = decideSubmitQuest(snap({ quest: q, submissions, member: { id: who, role: "member", active: true, dailyLimitOverride: null }, newSubmissionId: `s${i}` }), submit({ actor: memberActor(who), memberId: who }), NOW);
      for (const w of s.writes) if (w.t === "submission.upsert") submissions = [...submissions.filter((x) => x.id !== w.submission.id), w.submission];
      paid += s.entries.reduce((t, e) => t + e.amount, 0);
    }
    for (const s of [...submissions]) {
      const d = decideReviewSubmission({ quest: q, submission: s, submissions }, review("approve", { submissionId: s.id }), NOW);
      for (const w of d.writes) if (w.t === "submission.upsert") submissions = [...submissions.filter((x) => x.id !== w.submission.id), w.submission];
      paid += d.entries.reduce((t, e) => t + e.amount, 0);
      if (d.outcome.ok) approvals++;
    }
    expect(approvals).toBe(2);
    expect(paid).toBe(5 * approvals);
    expect(submissions.filter((s) => s.state === "approved")).toHaveLength(2);
  });
});
