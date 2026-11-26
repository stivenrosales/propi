"use server";
// Member writes. Each action builds exactly one domain command and hands it to execute (S106).
import type { MemberId } from "@propi/core";
import type { CelebrationVisibility } from "@propi/core/milestones";
import type { NotificationType } from "@propi/core/notify";
import { actionViewer } from "../auth";
import { envelope, finish, int, optStr, str } from "../command";
import { propi } from "../propi";
import { redeemQuantity } from "../shop-view";

/** S48, S50: redeem a reward from the web (the same command Slack sends). S2: `quantity` units in one step. */
export async function redeemAction(form: FormData) {
  const v = await actionViewer();
  const res = await propi().app.execute({ ...envelope(v, form), type: "Redeem", memberId: v.memberId, rewardId: str(form, "rewardId"), variantId: optStr(form, "variantId"), ...redeemQuantity(form) });
  finish("/app/shop", res, res.ok ? `Redeemed! Your redemption is ${res.value.state}.` : "");
}

/** S56, S59: contribute redeemable units to a collaborative reward. */
export async function contributeAction(form: FormData) {
  const v = await actionViewer();
  const res = await propi().app.execute({ ...envelope(v, form), type: "Contribute", collabId: str(form, "collabId"), memberId: v.memberId, amount: int(form, "amount") });
  finish("/app/collabs", res, res.ok ? `You chipped in ${res.value.taken}. ${res.value.raised} of ${res.value.goal} raised.` : "");
}

/** S64-S66: submit a quest for yourself or nominate a teammate. */
export async function submitQuestAction(form: FormData) {
  const v = await actionViewer();
  const nominee = optStr(form, "memberId");
  const res = await propi().app.execute({
    ...envelope(v, form),
    type: "SubmitQuest",
    questId: str(form, "questId"),
    memberId: (nominee ?? v.memberId) as MemberId,
    proof: optStr(form, "proof"),
    note: optStr(form, "note"),
  });
  finish("/app/quests", res, res.ok ? (res.value.state === "approved" ? "Submitted and approved!" : "Submitted. An approver will review it soon.") : "");
}

/** S64: comment on a submission's public timeline. */
export async function commentQuestAction(form: FormData) {
  const v = await actionViewer();
  const res = await propi().app.execute({ ...envelope(v, form), type: "CommentQuest", submissionId: str(form, "submissionId"), text: str(form, "text") });
  finish("/app/quests", res, "Comment posted.");
}

/** S79: choose an avatar the member's level unlocked. */
export async function chooseAvatarAction(form: FormData) {
  const v = await actionViewer();
  const res = await propi().app.execute({ ...envelope(v, form), type: "ChooseAvatar", avatarId: str(form, "avatarId") });
  finish("/app/profile", res, "Avatar updated.");
}

/** S92, S93: birthday, start date and how to celebrate. */
export async function setMilestonesAction(form: FormData) {
  const v = await actionViewer();
  const month = int(form, "birthMonth");
  const day = int(form, "birthDay");
  const start = optStr(form, "startDate");
  const res = await propi().app.execute({
    ...envelope(v, form),
    type: "SetMilestones",
    memberId: v.memberId,
    birthday: Number.isNaN(month) || Number.isNaN(day) ? null : { month, day },
    startDate: start as never,
    visibility: str(form, "visibility") as CelebrationVisibility,
  });
  finish("/app/profile", res, "Milestones saved.");
}

/** S95: opt in or out of pairing chats. */
export async function pairingOptInAction(form: FormData) {
  const v = await actionViewer();
  const res = await propi().app.execute({ ...envelope(v, form), type: "SetPairingOptIn", memberId: v.memberId, optedIn: form.get("optedIn") === "true" });
  finish("/app/profile", res, res.ok ? "Pairing preference saved." : "");
}

/** S85: turn one notification type on or off (core setPreference; preferences have no ledger command). */
export async function setPreferenceAction(form: FormData) {
  const v = await actionViewer();
  await propi().insights.setPreference(v.ws, v.memberId, str(form, "type") as NotificationType, form.get("on") === "true");
  finish("/app/profile", { ok: true }, "Notification preference saved.");
}
