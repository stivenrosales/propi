export const title = "Redemption (S49-S55)";
const L = { none: "Browsing the shop", refused: "Refused (not enough or out of stock)", pending: "Waiting for approval",
  approved: "Approved, waiting for delivery", fulfilled: "Delivered", rejected: "Rejected, units refunded", cancelled: "Cancelled, units refunded" };
export const state = (v) => L[v.state];
export const group = (v) => ({ none: "start", refused: "end", pending: "wait", approved: "wait", fulfilled: "end", rejected: "end", cancelled: "end" }[v.state]);
export const colors = { start: "blue", wait: "orange", end: "teal" };
export const step = (a, f, t) => ({
  MemberRedeems: t.state === "approved" ? "member redeems [auto-approval on]" : "member redeems [auto-approval off]",
  MemberIsRefused: "member tries to redeem [not enough units or no stock]",
  ApproverApproves: "approver approves",
  ApproverRejects: "approver rejects",
  AdminCancels: "admin cancels",
  Fulfilled: "approver or Pearson Projects marks it delivered",
  LateRetry: null, Done: null }[a]);
