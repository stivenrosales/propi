export const title = "Quest and one member's submissions (S64-S68), cap 1";
export const state = (v) => ({
  Quest: { draft: "Draft", open: "Open", closed: "Closed" }[v.quest],
  Submission: { none: "Not submitted", pending: "Waiting for review", approved: "Approved, units paid", rejected: "Rejected, may resubmit" }[v.sub],
});
export const step = (a, f, t) => ({
  AdminPublishes: "admin publishes the quest",
  MemberSubmits: t.sub === "approved" ? "member submits [while Open, no approval required]" : "member submits [while Open, approval required]",
  ApproverApproves: "approver approves", ApproverRejects: "approver rejects",
  QuestCloses: "admin closes it or the window ends", Done: null }[a]);
