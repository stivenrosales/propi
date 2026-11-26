"use server";
// Admin and approver writes. Ledger, shop and engagement writes are domain commands through execute
// (S106). Workspace settings, roles and values have no domain command yet; they go through the db
// admin port after the same checks core exposes (canChangeRole, validateCurrency).
import { canChangeRole, isPosInt, nodeCrypto, type ApiTokenId, type GiftId, type MemberId, type PosInt, type ValueId } from "@propi/app";
import { uuidv7Ids } from "@propi/db";
import type { RuleCriterion } from "@propi/core/rules";
import type { QuestReward, SubmitterMode } from "@propi/core/quests";
import type { InsightsSettings } from "@propi/core/boards";
import { actions } from "@/i18n/actions.messages";
import { errors } from "@/i18n/errors.messages";
import { getLocale } from "@/i18n/locale";
import { errorMessage } from "@/lib/format";
import { actionViewer } from "../auth";
import { bool, envelope, fail, finish, int, optInt, optStr, str, subKey } from "../command";
import { propi } from "../propi";
import { parseWorkspaceSettings } from "../settings-form";
import { registerEndpoint } from "../webhook-endpoints";

const ids = (form: FormData, name: string) => form.getAll(name).map(String).filter((s) => s !== "") as MemberId[];
const lines = (text: string) => text.split(/[,\n]/).map((s) => s.trim()).filter((s) => s !== "");

// ───────────── Settings (S1-S3, S8, S12, S14, S16, S18, S25-S26, S47, S52, S69, S70, S81, S86-S90) ─────────────

export async function saveWorkspaceSettingsAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const p = propi();
  const parsed = parseWorkspaceSettings(form, await p.ports.directory.settings(v.ws));
  if (!parsed.ok) finish("/admin/settings", parsed, "", L);
  await p.admin.updateSettings(v.ws, () => parsed.value);
  finish("/admin/settings", { ok: true }, t("workspace"), L);
}

export async function saveBoardSettingsAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const share = int(form, "minSharePercent");
  const minGifts = int(form, "minGifts");
  const weeks = int(form, "isolationWeeks");
  const weekday = int(form, "nudgeWeekday");
  if (![share, minGifts, weeks, weekday].every(Number.isInteger) || weekday < 1 || weekday > 7 || weeks < 1 || share < 1 || share > 100 || minGifts < 1) {
    finish("/admin/settings", fail("invalid_field", { field: "insights" }), "", L);
  }
  const over: Partial<InsightsSettings> = {
    showPrivateGifts: bool(form, "showPrivateGifts"),
    giverMode: bool(form, "giverMode"),
    nudge: { enabled: bool(form, "nudgeEnabled"), weekday },
    isolationWeeks: weeks,
    reciprocity: { minSharePercent: share, minGifts },
    shopUrl: optStr(form, "shopUrl"),
  };
  await propi().insights.setSettings(v.ws, over);
  finish("/admin/settings", { ok: true }, t("boards"), L);
}

export async function saveShopSettingsAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const budget = optInt(form, "budgetMinor");
  const currency = str(form, "budgetCurrency").toUpperCase();
  const res = await propi().app.execute({
    ...envelope(v, form),
    type: "ConfigureShop",
    settings: { autoApprove: bool(form, "autoApprove"), monthlyBudget: budget === null ? null : { minor: budget, currency } },
  });
  finish("/admin/settings", res, t("shop"), L);
}

export async function saveModulesAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const base = envelope(v, form);
  const app = propi().app;
  const stickers = await app.execute({ ...subKey(base, "stickers"), type: "ConfigureStickers", enabled: bool(form, "stickers") });
  if (!stickers.ok) finish("/admin/settings", stickers, "", L);
  const pairing = await app.execute({
    ...subKey(base, "pairing"),
    type: "ConfigurePairing",
    config: {
      enabled: bool(form, "pairing"),
      cadence: str(form, "pairingCadence") as "weekly" | "biweekly" | "monthly",
      avoidRepeatsWithin: int(form, "avoidRepeatsWithin"),
      prompts: lines(str(form, "prompts")),
    },
  });
  if (!pairing.ok) finish("/admin/settings", pairing, "", L);
  const milestones = await app.execute({
    ...subKey(base, "milestones"),
    type: "ConfigureMilestones",
    config: {
      channelId: optStr(form, "celebrationChannel"),
      localTime: str(form, "celebrationTime"),
      birthdayBonus: optInt(form, "birthdayBonus") as PosInt | null,
      anniversaryBonus: optInt(form, "anniversaryBonus") as PosInt | null,
    },
  });
  finish("/admin/settings", milestones, t("modules"), L);
}

// ───────────── Members and roles (S5-S7, S25, S80) ─────────────

export async function saveMemberAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const p = propi();
  const id = str(form, "memberId") as MemberId;
  const current = await p.ports.directory.member(v.ws, id);
  if (current === null) finish("/admin/members", fail("unknown_member", { memberId: id }), "", L);
  const role = str(form, "role") as "admin" | "approver" | "member";
  if (!["admin", "approver", "member"].includes(role)) finish("/admin/members", fail("invalid_field", { field: "role" }), "", L);
  // S5: only admins change roles, and never their own (that includes deactivating themselves).
  if ((role !== current.role || bool(form, "active") !== current.active) && !canChangeRole(v.actor, id)) finish("/admin/members", fail("forbidden", { need: "admin" }), "", L);
  const limit = optInt(form, "dailyLimitOverride");
  if (limit !== null && !isPosInt(limit)) finish("/admin/members", fail("invalid_field", { field: "dailyLimitOverride" }), "", L);
  await p.admin.addMember(v.ws, { id, role, active: bool(form, "active"), dailyLimitOverride: limit as PosInt | null });
  const settings = await p.insights.source.settings(v.ws);
  const excluded = new Set(settings.excludedFromBoards);
  if (bool(form, "excluded")) excluded.add(id);
  else excluded.delete(id);
  await p.insights.setSettings(v.ws, { excludedFromBoards: [...excluded].sort() });
  finish("/admin/members", { ok: true }, t("member"), L);
}

// ───────────── Adjustments (S36-S39) ─────────────

export async function bonusAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const res = await propi().app.execute({ ...envelope(v, form), type: "GrantBonus", memberIds: ids(form, "memberIds"), amount: int(form, "amount") as PosInt, reason: str(form, "reason") });
  finish("/admin/adjustments", res, t("bonus"), L);
}

export async function deductAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const res = await propi().app.execute({ ...envelope(v, form), type: "Deduct", memberId: str(form, "memberId") as MemberId, amount: int(form, "amount") as PosInt, reason: str(form, "reason") });
  finish("/admin/adjustments", res, t("deduction"), L);
}

export async function reverseGiftAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const res = await propi().app.execute({ ...envelope(v, form), type: "ReverseGift", giftId: str(form, "giftId") as GiftId, reason: str(form, "reason") });
  finish("/admin/adjustments", res, t("reversed"), L);
}

export async function resetAllAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  if (str(form, "confirm") !== "RESET") finish("/admin/adjustments", fail("invalid_field", { field: "confirm" }), "", L);
  const res = await propi().app.execute({ ...envelope(v, form), type: "ResetAllRedeemable", reason: str(form, "reason") });
  finish("/admin/adjustments", res, t("reset"), L);
}

// ───────────── Values (S41) ─────────────

export async function saveValuesAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const names = form.getAll("name").map(String);
  const hashtags = form.getAll("hashtag").map(String);
  const emojis = form.getAll("emoji").map(String);
  const valueIds = form.getAll("id").map(String);
  const values = [];
  for (const [i, raw] of names.entries()) {
    const name = raw.trim();
    if (name === "") continue;
    const tag = (hashtags[i] ?? "").trim();
    const emoji = (emojis[i] ?? "").trim();
    if (tag !== "" && !/^#?[\p{L}\p{N}_-]+$/u.test(tag)) finish("/admin/values", fail("invalid_field", { field: `hashtag of ${name}` }), "", L);
    if (emoji !== "" && !/^:[\w+-]+:$/.test(emoji)) finish("/admin/values", fail("invalid_field", { field: `emoji of ${name}` }), "", L);
    values.push({ id: ((valueIds[i] ?? "").trim() || uuidv7Ids.next("value")) as ValueId, name, hashtag: tag === "" ? null : tag.startsWith("#") ? tag : `#${tag}`, emoji: emoji === "" ? null : emoji });
  }
  await propi().admin.setValues(v.ws, values);
  finish("/admin/values", { ok: true }, t("values"), L);
}

// ───────────── Rewards and collabs (S44-S47, S55, S56, S58) ─────────────

function rewardInput(form: FormData) {
  const internal = optInt(form, "internalCostMinor");
  const autoApprove = str(form, "autoApprove");
  return {
    title: str(form, "title"),
    description: str(form, "description"),
    image: optStr(form, "image"),
    cost: int(form, "cost"),
    categories: lines(str(form, "categories")),
    internalCost: internal === null ? null : { minor: internal, currency: str(form, "internalCurrency").toUpperCase() || "USD" },
    instructions: str(form, "instructions"),
    autoApprove: autoApprove === "" ? null : autoApprove === "true",
  };
}

export async function createRewardAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const variants = lines(str(form, "variants")).map((line, i) => {
    const [name = "", stock = ""] = line.split(":").map((s) => s.trim());
    return { id: `v${i + 1}`, name, stock: stock === "" ? null : Number(stock) };
  });
  const res = await propi().app.execute({
    ...envelope(v, form),
    type: "CreateReward",
    reward: { ...rewardInput(form), stock: optInt(form, "stock"), variants, giftCard: bool(form, "giftCard") },
  });
  finish("/admin/rewards", res, t("reward.created"), L);
}

export async function updateRewardAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const res = await propi().app.execute({ ...envelope(v, form), type: "UpdateReward", rewardId: str(form, "rewardId"), changes: rewardInput(form) });
  finish("/admin/rewards", res, t("reward.updated"), L);
}

export async function setRewardStatusAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const status = str(form, "status") === "archived" ? "archived" : "active";
  const res = await propi().app.execute({ ...envelope(v, form), type: "SetRewardStatus", rewardId: str(form, "rewardId"), status });
  finish("/admin/rewards", res, status === "active" ? t("reward.live") : t("reward.archived"), L);
}

export async function restockAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const res = await propi().app.execute({ ...envelope(v, form), type: "Restock", rewardId: str(form, "rewardId"), variantId: optStr(form, "variantId"), quantity: int(form, "quantity") as PosInt });
  finish("/admin/rewards", res, t("restocked"), L);
}

/** S55: a manual redemption on behalf of a member. */
export async function redeemOnBehalfAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const res = await propi().app.execute({ ...envelope(v, form), type: "Redeem", memberId: str(form, "memberId") as MemberId, rewardId: str(form, "rewardId"), variantId: optStr(form, "variantId") });
  finish("/admin/rewards", res, t("onBehalf"), L);
}

export async function createCollabAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const deadline = optStr(form, "deadline");
  const res = await propi().app.execute({
    ...envelope(v, form),
    type: "CreateCollab",
    title: str(form, "title"),
    description: str(form, "description"),
    goal: int(form, "goal"),
    deadline: deadline === null ? null : (Date.parse(`${deadline}T23:59:59Z`) as never),
    autoApprove: bool(form, "autoApprove"),
  });
  finish("/admin/rewards", res, t("collab.created"), L);
}

export async function archiveCollabAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const res = await propi().app.execute({ ...envelope(v, form), type: "CloseCollab", collabId: str(form, "collabId"), why: "archived" });
  finish("/admin/rewards", res, t("collab.archived"), L);
}

// ───────────── Redemption queue (S49-S53), approvers allowed (S6) ─────────────

export async function transitionRedemptionAction(form: FormData) {
  const v = await actionViewer("approver");
  const L = await getLocale();
  const t = actions.t(L);
  const transition = str(form, "transition") as "approve" | "reject" | "cancel" | "fulfil";
  const res = await propi().app.execute({ ...envelope(v, form), type: "TransitionRedemption", redemptionId: str(form, "redemptionId"), transition, reason: optStr(form, "reason") });
  const done = (["approve", "reject", "cancel", "fulfil"] as const).includes(transition) ? t(`redemption.${transition}`) : t("redemption.updated");
  finish("/admin/redemptions", res, done, L);
}

// ───────────── Award rules (S60) ─────────────

export async function defineRuleAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const kind = str(form, "criterion");
  const n = int(form, "n") as PosInt;
  const criterion: RuleCriterion =
    kind === "top_givers" ? { kind, n } : kind === "distinct_receivers" ? { kind, k: n } : kind === "giving_streak" ? { kind, periods: n } : kind === "most_tagged" ? { kind, valueId: str(form, "valueId") as ValueId } : { kind: "top_receivers", n };
  const res = await propi().app.execute({
    ...envelope(v, form),
    type: "DefineAwardRule",
    rule: {
      id: str(form, "ruleId") || uuidv7Ids.next("rule"),
      name: str(form, "name"),
      period: str(form, "period") as "week" | "month" | "quarter",
      criterion,
      reward: int(form, "reward") as PosInt,
      ties: str(form, "ties") === "skip_tied" ? "skip_tied" : "all_win",
      active: str(form, "active") !== "false",
      announceChannel: optStr(form, "announceChannel"),
    },
  });
  finish("/admin/rules", res, t("rule"), L);
}

// ───────────── Quests (S64-S66) ─────────────

export async function defineQuestAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const mode = str(form, "rewardMode");
  const reward: QuestReward = mode === "approver_choice" ? { mode } : mode === "recognition" ? { mode } : { mode: "fixed", amount: int(form, "rewardAmount") as PosInt };
  const opens = optStr(form, "opensAt");
  const closes = optStr(form, "closesAt");
  const res = await propi().app.execute({
    ...envelope(v, form),
    type: "DefineQuest",
    quest: {
      id: str(form, "questId") || uuidv7Ids.next("quest"),
      title: str(form, "title"),
      description: str(form, "description"),
      image: optStr(form, "image"),
      reward,
      submitters: (str(form, "submitters") || "self") as SubmitterMode,
      proofRequired: bool(form, "proofRequired"),
      approvalRequired: bool(form, "approvalRequired"),
      timeline: bool(form, "timeline"),
      perSubmitterCap: optInt(form, "perSubmitterCap") as PosInt | null,
      teamCap: optInt(form, "teamCap") as PosInt | null,
      cooldownMs: (optInt(form, "cooldownHours") ?? 0) * 3_600_000,
      opensAt: opens === null ? null : (Date.parse(`${opens}T00:00:00Z`) as never),
      closesAt: closes === null ? null : (Date.parse(`${closes}T23:59:59Z`) as never),
      trigger: null,
    },
  });
  finish("/admin/quests", res, t("quest.saved"), L);
}

export async function questStateAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const questId = str(form, "questId");
  const res = str(form, "to") === "closed" ? await propi().app.execute({ ...envelope(v, form), type: "CloseQuest", questId }) : await propi().app.execute({ ...envelope(v, form), type: "PublishQuest", questId });
  finish("/admin/quests", res, t("quest.updated"), L);
}

/** S66, approvers allowed (S6). */
export async function reviewSubmissionAction(form: FormData) {
  const v = await actionViewer("approver");
  const L = await getLocale();
  const t = actions.t(L);
  const verdict = str(form, "verdict") === "reject" ? "reject" : "approve";
  const res = await propi().app.execute({ ...envelope(v, form), type: "ReviewSubmission", submissionId: str(form, "submissionId"), verdict, amount: optInt(form, "amount") as PosInt | null, note: optStr(form, "note") });
  finish("/admin/submissions", res, verdict === "approve" ? t("submission.approved") : t("submission.rejected"), L);
}

// ───────────── Stickers (S73-S76) ─────────────

export async function defineStickerAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const receivers = str(form, "receivers");
  const res = await propi().app.execute({
    ...envelope(v, form),
    type: "DefineSticker",
    sticker: {
      id: str(form, "stickerId") || uuidv7Ids.next("sticker"),
      name: str(form, "name"),
      image: optStr(form, "image"),
      receivers: receivers === "channel" ? "channel" : (Number(receivers) as PosInt),
      unitsPerReceiver: int(form, "unitsPerReceiver") as PosInt,
      monthlyQuota: (optInt(form, "monthlyQuota") ?? 1) as PosInt,
      active: str(form, "active") !== "false",
    },
  });
  finish("/admin/stickers", res, t("sticker"), L);
}

export async function grantStickerAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const res = await propi().app.execute({ ...envelope(v, form), type: "GrantStickerUses", memberId: str(form, "memberId") as MemberId, stickerId: str(form, "stickerId"), uses: int(form, "uses") as PosInt });
  finish("/admin/stickers", res, t("stickerUses"), L);
}

// ───────────── API tokens and webhooks (S98, S99): the secret is returned once, never stored in plaintext ─────────────

export interface RevealState {
  readonly secret: string | null;
  readonly label: string | null;
  readonly error: string | null;
}

export async function issueTokenAction(_prev: RevealState, form: FormData): Promise<RevealState> {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const res = await propi().tokens().issue(v.actor, v.ws, { name: str(form, "name"), scopes: form.getAll("scopes").map(String) });
  if (!res.ok) return { secret: null, label: null, error: errorMessage(L, res.error) };
  return { secret: res.value.token, label: res.value.view.name, error: null };
}

export async function revokeTokenAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const res = await propi().tokens().revoke(v.actor, v.ws, str(form, "tokenId") as ApiTokenId);
  finish("/admin/api", res.ok ? { ok: true } : { ok: false, error: res.error }, t("token.revoked"), L);
}

export async function createEndpointAction(_prev: RevealState, form: FormData): Promise<RevealState> {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const stores = propi().apiStores();
  const res = await registerEndpoint(
    { save: (e) => stores.endpoints.save(e), crypto: nodeCrypto, ids: uuidv7Ids, allowHttp: process.env.NODE_ENV !== "production" },
    v.actor,
    v.ws,
    { url: str(form, "url"), events: form.getAll("events").map(String) },
  );
  if (!res.ok) return { secret: null, label: null, error: res.error.code === "forbidden" ? errors.t(L)("endpoint.forbidden") : errors.t(L)("endpoint.field", { field: errors.t(L)(`field.${res.error.field}` as "field.url") }) };
  return { secret: res.value.secret, label: res.value.endpoint.url, error: null };
}

export async function toggleEndpointAction(form: FormData) {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const t = actions.t(L);
  const stores = propi().apiStores();
  const e = await stores.endpoints.get(v.ws, str(form, "endpointId"));
  if (e === null) finish("/admin/api", fail("not_found", { what: "endpoint" }), "", L);
  await stores.endpoints.save({ ...e, active: !e.active });
  finish("/admin/api", { ok: true }, e.active ? t("endpoint.paused") : t("endpoint.resumed"), L);
}
