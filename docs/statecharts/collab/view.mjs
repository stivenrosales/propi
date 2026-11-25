export const title = "Collaborative reward (S56-S59), goal 3";
const raised = (v) => Object.values(v.contrib).reduce((a, b) => a + b, 0);
export const state = (v) => ({
  open: `Collecting (${raised(v)} of 3)`, completed: "Goal reached, group redemption pending",
  delivered: "Delivered", refunded: "Closed, everyone refunded" }[v.phase]);
export const group = (v) => ({ open: "collect", completed: "wait", delivered: "end", refunded: "end" }[v.phase]);
export const colors = { collect: "blue", wait: "orange", end: "teal" };
export const step = (a, f, t) => {
  if (a === "SomeoneContributes" || a === "Contribute") return t.phase === "completed" ? "a member contributes the rest [extra is capped]" : "a member contributes";
  return { ClosedEarly: "admin archives it or the deadline passes", GroupRedemptionRejected: "approver rejects the group redemption",
    GroupRedemptionDelivered: "the reward is delivered", Done: null }[a];
};
