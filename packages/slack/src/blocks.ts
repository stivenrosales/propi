// Block Kit rendering for DMs, channel posts, the App Home and the /propi replies (S13, S28, S29,
// S48, S54, S61, S83, S84, S86, S89, S93, S95). Pure: data in, Slack message/view JSON out. Every
// unit name comes from the workspace currency (S1); nothing here is hard-coded to tacos.
// i18n S1, S4d: every text is in `ctx.locale`; the caller picks it (the recipient member's language
// for DMs, App Home and ephemeral replies, the workspace default for channel posts).
import type { AllowanceView, Balances, Currency, DomainError, MemberId, Reward } from "@propi/app";
import type { LeaderboardRow } from "@propi/core/boards";
import { formatNumber, type Locale } from "@propi/core/i18n";
import type { Notification } from "@propi/core/notify";
import { errors, states } from "./i18n/errors.messages.ts";
import { home } from "./i18n/home.messages.ts";
import { notifications } from "./i18n/notifications.messages.ts";
import { shop } from "./i18n/shop.messages.ts";
import { ACTIONS, redeemQuantityValue, redeemValue } from "./interact.ts";

/** A Block Kit block. Kept structural: Slack validates the JSON, tests pin the shapes. */
export type Block = { readonly type: string } & Readonly<Record<string, unknown>>;

export interface SlackMessageBody {
  /** Fallback text for notifications and screen readers. */
  readonly text: string;
  readonly blocks: readonly Block[];
}

export interface HomeView {
  readonly type: "home";
  readonly blocks: readonly Block[];
}

export interface RenderContext {
  readonly currency: Currency;
  /** How to name a member in Slack: `<@U…>` when linked, else a neutral word. */
  who(member: MemberId): string;
  /** The web app (shop, dashboards), when configured. */
  readonly appUrl: string | null;
  /** i18n S4d: the language of the reader (a member's for DMs and replies, the workspace's for channel posts). */
  readonly locale: Locale;
}

const md = (text: string): Block => ({ type: "section", text: { type: "mrkdwn", text } });
const context = (text: string): Block => ({ type: "context", elements: [{ type: "mrkdwn", text }] });
const header = (text: string): Block => ({ type: "header", text: { type: "plain_text", text: text.slice(0, 150), emoji: true } });
const divider: Block = { type: "divider" };
const button = (text: string, actionId: string, value: string, style?: "primary" | "danger", confirm?: Block): Block => ({
  type: "button",
  text: { type: "plain_text", text, emoji: true },
  action_id: actionId,
  value,
  ...(style === undefined ? {} : { style }),
  ...(confirm === undefined ? {} : { confirm }),
});
const msg = (text: string, ...blocks: Block[]): SlackMessageBody => ({ text, blocks: blocks.length === 0 ? [md(text)] : blocks });

/** "3 tacos" with the number formatted for the reader; the unit names are workspace data (S1). */
const amount = (ctx: RenderContext, n: number) => `${formatNumber(ctx.locale, n)} ${Math.abs(n) === 1 ? ctx.currency.singular : ctx.currency.plural}`;
const units = (ctx: RenderContext, n: number) => `${ctx.currency.primaryEmoji} ${amount(ctx, n)}`;
const num = (ctx: RenderContext, n: number) => formatNumber(ctx.locale, n);
const list = (items: readonly string[]) => items.join(", ");

/** A redemption's or submission's state as a word in the reader's language. */
export const stateText = (state: string, locale: Locale): string => (state in states.en ? states.t(locale)(state as keyof typeof states.en) : state);

/** Slack mrkdwn escaping for user-provided text. */
export const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** S13 and friends: a refusal in plain words. */
export function errorText(error: DomainError, ctx: RenderContext): string {
  const t = errors.t(ctx.locale);
  switch (error.code) {
    case "over_allowance":
      return t("over_allowance", { cost: amount(ctx, error.cost), remaining: amount(ctx, error.remaining), plural: ctx.currency.plural });
    case "channel_not_allowed":
      return t("channel_not_allowed", { plural: ctx.currency.plural });
    case "inactive_member":
    case "bots_may_not_give":
    case "out_of_stock":
    case "budget_exceeded":
    case "plan_limit":
    case "forbidden":
    case "idempotency_key_reused":
      return t(error.code);
    case "insufficient_redeemable":
      return t("insufficient_redeemable", { cost: amount(ctx, error.cost), redeemable: amount(ctx, error.redeemable) });
    case "reward_not_active":
    case "reward_not_found":
      return t("reward_unavailable");
    case "illegal_transition":
      return t("illegal_transition", { state: stateText(error.from, ctx.locale) });
    default:
      return t("unknown", { code: error.code });
  }
}

/** S29, S83, S13, S84, S86, S89: one private notification. */
export function notificationMessage(n: Notification, ctx: RenderContext): SlackMessageBody {
  const t = notifications.t(ctx.locale);
  switch (n.type) {
    case "gift_confirmation":
      return msg(
        n.remainingAllowance === null
          ? t("gift.confirmation", { amount: units(ctx, n.totalCost) })
          : t("gift.confirmationLeft", { amount: units(ctx, n.totalCost), left: amount(ctx, n.remainingAllowance) }),
      );
    case "gift_received": {
      const quote = n.text === null || n.text === "" ? [] : [context(`> ${escapeText(n.text).replace(/\n/g, "\n> ")}`)];
      const text =
        n.channelId === null
          ? t("gift.received", { giver: ctx.who(n.giver), amount: units(ctx, n.amount) })
          : t("gift.receivedIn", { giver: ctx.who(n.giver), amount: units(ctx, n.amount), channel: `<#${n.channelId}>` });
      return msg(text, md(text), ...quote);
    }
    case "gift_rejected":
      return msg(t("gift.rejected", { reason: errorText(n.error, ctx) }));
    case "adjustment":
      return msg(t(n.kind === "bonus" ? "adjustment.bonus" : "adjustment.removed", { amount: units(ctx, n.amount), reason: escapeText(n.reason) }));
    case "weekly_report": {
      const r = n.report;
      const top = r.topGivers.length === 0 ? t("report.nobodyYet") : list(r.topGivers.map((g) => `${ctx.who(g.memberId)} (${num(ctx, g.units)})`));
      const gave = r.gaveTo.length === 0 ? t("report.nobodyThisWeek") : list(r.gaveTo.map((g) => `${ctx.who(g.memberId)} (${num(ctx, g.units)})`));
      const shopUrl = r.shopUrl ?? (ctx.appUrl === null ? null : `${ctx.appUrl}/shop`);
      const text = t("report.title", { plural: ctx.currency.plural, week: r.week });
      return msg(
        text,
        header(text),
        md(t("report.team", { total: amount(ctx, r.team.monthToDate), last: r.team.lastMonthSamePoint })),
        md(t("report.topGivers", { list: top })),
        md(t("report.own", { total: amount(ctx, r.own.monthToDate), last: r.own.lastMonthSamePoint, list: gave })),
        md(`${t("report.spend", { amount: units(ctx, r.redeemable) })}${shopUrl === null ? "" : ` · <${shopUrl}|${t("report.openShop")}>`}`),
      );
    }
    case "nudge":
      return msg(t("nudge", { amount: amount(ctx, n.unused), emoji: ctx.currency.primaryEmoji }));
    case "isolation_alert":
      return msg(t("isolation", { plural: ctx.currency.plural, weeks: n.weeks, list: list(n.isolated.map((id) => ctx.who(id))) }));
  }
}

export interface RedemptionNotice {
  readonly type: `redemption.${"created" | "approved" | "rejected" | "cancelled" | "fulfilled"}`;
  readonly cost: number;
  /** S2: units in the redemption; absent or 1 reads as before. */
  readonly quantity?: number;
  readonly rewardTitle: string | null;
}

/** S2: "Mug" for one unit, "3 × Mug" for a batch. */
const unitsOf = (title: string, quantity: number | undefined): string => (quantity === undefined || quantity === 1 ? title : `${quantity} × ${title}`);

/** S54: the member's private notice for a redemption state change. */
export function redemptionMessage(e: RedemptionNotice, ctx: RenderContext): SlackMessageBody {
  const t = notifications.t(ctx.locale);
  const what = e.rewardTitle === null ? t("redemption.yours") : `*${escapeText(unitsOf(e.rewardTitle, e.quantity))}*`;
  switch (e.type) {
    case "redemption.created":
      return msg(t("redemption.created", { what, amount: units(ctx, e.cost) }));
    case "redemption.approved":
    case "redemption.fulfilled":
      return msg(t(e.type, { what }));
    case "redemption.rejected":
    case "redemption.cancelled":
      return msg(t(e.type, { what, refund: amount(ctx, e.cost) }));
  }
}

/** S6: the approver's request, with buttons that send TransitionRedemption. */
export function redemptionApprovalMessage(
  r: { readonly redemptionId: string; readonly member: MemberId | null; readonly rewardTitle: string | null; readonly cost: number; readonly quantity?: number },
  ctx: RenderContext,
): SlackMessageBody {
  const t = notifications.t(ctx.locale);
  const who = r.member === null ? t("approval.aGroup") : ctx.who(r.member);
  const what = r.rewardTitle === null ? t("approval.aReward") : `*${escapeText(unitsOf(r.rewardTitle, r.quantity))}*`;
  const text = t("approval.redeemed", { who, what, amount: units(ctx, r.cost) });
  return msg(text, md(text), {
    type: "actions",
    elements: [button(t("approval.approve"), ACTIONS.approveRedemption, r.redemptionId, "primary"), button(t("approval.reject"), ACTIONS.rejectRedemption, r.redemptionId, "danger")],
  });
}

/** S6, S64: the approver's request for a quest submission. */
export function submissionApprovalMessage(s: { readonly submissionId: string; readonly member: MemberId; readonly questTitle: string | null }, ctx: RenderContext): SlackMessageBody {
  const t = notifications.t(ctx.locale);
  const text = t("submission.waiting", { who: ctx.who(s.member), what: s.questTitle === null ? t("quest.a") : `*${escapeText(s.questTitle)}*` });
  return msg(text, md(text), {
    type: "actions",
    elements: [button(t("approval.approve"), ACTIONS.approveSubmission, s.submissionId, "primary"), button(t("approval.reject"), ACTIONS.rejectSubmission, s.submissionId, "danger")],
  });
}

/** The reply on a button press: what happened, privately. */
export function actionResultText(ok: boolean, okText: string, error: DomainError | null, ctx: RenderContext): string {
  return ok || error === null ? okText : errorText(error, ctx);
}

export function questMessage(e: { readonly type: "quest.approved" | "quest.rejected"; readonly amount?: number }, title: string | null, ctx: RenderContext): SlackMessageBody {
  const t = notifications.t(ctx.locale);
  const what = title === null ? t("quest.a") : `*${escapeText(title)}*`;
  if (e.type === "quest.rejected") return msg(t("quest.rejected", { what }));
  return msg(e.amount === undefined ? t("quest.approved", { what }) : t("quest.approvedAmount", { what, amount: units(ctx, e.amount) }));
}

/** S61: a rule award announcement. */
export const ruleAwardMessage = (e: { readonly winners: readonly MemberId[]; readonly amount: number; readonly period: string }, ctx: RenderContext): SlackMessageBody =>
  msg(notifications.t(ctx.locale)("ruleAward", { period: e.period, winners: list(e.winners.map((w) => ctx.who(w))), amount: units(ctx, e.amount) }));

/** S93: a celebration post or DM. */
export function celebrationMessage(e: { readonly memberId: MemberId; readonly kind: string; readonly years: number | null }, ctx: RenderContext): SlackMessageBody {
  const t = notifications.t(ctx.locale);
  const who = ctx.who(e.memberId);
  if (e.kind === "birthday") return msg(t("birthday", { who }));
  return msg(e.years === null ? t("anniversary", { who }) : t("anniversaryYears", { count: e.years, who }));
}

/** S95: the pairing group DM. */
export const pairingMessage = (e: { readonly groups: unknown; readonly prompt: string | null }, members: readonly MemberId[], ctx: RenderContext): SlackMessageBody =>
  msg(`${notifications.t(ctx.locale)("pairing", { names: list(members.map((id) => ctx.who(id))) })}${e.prompt === null ? "" : `\n> ${escapeText(e.prompt)}`}`);

/** S57, S58: collaborative reward outcomes for contributors. */
export function collabMessage(e: { readonly type: "collab.completed" | "collab.refunded"; readonly total?: number }, ctx: RenderContext): SlackMessageBody {
  const t = notifications.t(ctx.locale);
  if (e.type === "collab.completed") return msg(t("collab.completed"));
  return msg(e.total === undefined ? t("collab.refunded") : t("collab.refundedTotal", { total: amount(ctx, e.total) }));
}

/** S90 (admins): reciprocity pairs to review. */
export const reciprocityMessage = (pairs: readonly { readonly a: MemberId; readonly b: MemberId }[], period: string, ctx: RenderContext): SlackMessageBody =>
  msg(notifications.t(ctx.locale)("reciprocity", { period, plural: ctx.currency.plural, pairs: pairs.map((p) => `• ${ctx.who(p.a)} ↔ ${ctx.who(p.b)}`).join("\n") }));

/** S91 (admins): the monthly digest. */
export function digestMessage(d: { readonly month: string; readonly team: readonly { readonly title: string; readonly summary: string }[] }, ctx: RenderContext): SlackMessageBody {
  const t = notifications.t(ctx.locale);
  const text = t("digest.title", { month: d.month });
  const themes = d.team.length === 0 ? [md(t("digest.empty", { plural: ctx.currency.plural }))] : d.team.map((x) => md(`*${escapeText(x.title)}*\n${escapeText(x.summary)}`));
  return msg(text, header(text), ...themes);
}

// ───────────── /propi, the shop and the App Home (S28, S48) ─────────────

export function balanceMessage(b: Balances, a: AllowanceView, ctx: RenderContext): SlackMessageBody {
  const t = shop.t(ctx.locale);
  return msg(
    t("balance.text", { spend: amount(ctx, b.redeemable), give: amount(ctx, a.remaining) }),
    md(t("balance.blocks", { spend: units(ctx, b.redeemable), left: amount(ctx, a.remaining), limit: a.limit, received: b.received, given: b.given })),
  );
}

export function helpMessage(ctx: RenderContext): SlackMessageBody {
  const t = home.t(ctx.locale);
  return msg(t("help.title"), md(t("help.give", { emoji: ctx.currency.primaryEmoji })), md(t("help.commands")));
}

/** S2: the most units the "Redeem more" picker offers; the web shop has no such cap. */
const PICKER_MAX = 10;

/**
 * S2: a static_select of 2..N units per available option (N capped by balance, stock and PICKER_MAX),
 * each label showing the total. Null when no option allows two units. Core stays the source of truth.
 */
function quantityPicker(r: Reward, options: readonly { label: string; rewardId: string; variantId: string | null; stock: number | null }[], redeemable: number, ctx: RenderContext): Block | null {
  const t = shop.t(ctx.locale);
  const byBalance = Math.floor(redeemable / r.cost);
  const choices = options.flatMap((o) => {
    const max = Math.min(PICKER_MAX, byBalance, o.stock ?? PICKER_MAX);
    return Array.from({ length: Math.max(0, max - 1) }, (_, i) => i + 2).map((q) => ({
      text: { type: "plain_text", text: `${q} × ${o.label} · ${amount(ctx, r.cost * q)}`.slice(0, 75), emoji: true },
      value: redeemQuantityValue(o.rewardId, o.variantId, q),
    }));
  });
  if (choices.length === 0) return null;
  return {
    type: "static_select",
    action_id: ACTIONS.redeemQuantity,
    placeholder: { type: "plain_text", text: t("picker.placeholder"), emoji: true },
    options: choices.slice(0, 100),
    confirm: {
      type: "confirm" as const,
      title: { type: "plain_text", text: t("picker.title") },
      text: { type: "mrkdwn", text: t("picker.text", { title: escapeText(r.title) }) },
      confirm: { type: "plain_text", text: t("redeem") },
      deny: { type: "plain_text", text: t("cancel") },
    },
  };
}

function rewardBlocks(r: Reward, redeemable: number, ctx: RenderContext): Block[] {
  const t = shop.t(ctx.locale);
  const stock = r.variants.length === 0 && r.stock !== null ? ` · ${t("stockLeft", { count: r.stock })}` : "";
  const desc = r.description === "" ? "" : `\n${escapeText(r.description)}`;
  const section: Block = { ...md(`*${escapeText(r.title)}* · ${units(ctx, r.cost)}${stock}${desc}`) };
  const affordable = redeemable >= r.cost;
  const confirm = (label: string): Block => ({
    type: "confirm" as const,
    title: { type: "plain_text", text: t("confirm.title") },
    text: { type: "mrkdwn", text: t("confirm.text", { cost: amount(ctx, r.cost), label: escapeText(label) }) },
    confirm: { type: "plain_text", text: t("redeem") },
    deny: { type: "plain_text", text: t("cancel") },
  });
  const options =
    r.variants.length === 0
      ? [{ label: r.title, value: redeemValue(r.id, null), out: r.stock !== null && r.stock <= 0, variantId: null, stock: r.stock }]
      : r.variants.map((v) => ({ label: `${r.title} (${v.name})`, value: redeemValue(r.id, v.id), out: v.stock !== null && v.stock <= 0, name: v.name, variantId: v.id, stock: v.stock }));
  const available = options.filter((o) => !o.out).slice(0, 5);
  const buttons = available.map((o) => button("name" in o ? t("redeemVariant", { name: o.name }) : t("redeem"), ACTIONS.redeem, o.value, "primary", confirm(o.label)));
  if (!affordable || buttons.length === 0) return [section, context(buttons.length === 0 ? t("outOfStock") : t("needMore", { amount: amount(ctx, r.cost - redeemable) }))];
  const picker = quantityPicker(r, available.map((o) => ({ label: o.label, rewardId: r.id, variantId: o.variantId, stock: o.stock })), redeemable, ctx);
  return [section, { type: "actions", elements: picker === null ? buttons : [...buttons, picker] }];
}

export function shopBlocks(rewards: readonly Reward[], redeemable: number, ctx: RenderContext, limit = 15): Block[] {
  const active = rewards.filter((r) => r.status === "active");
  const t = shop.t(ctx.locale);
  if (active.length === 0) return [md(t("empty"))];
  const out: Block[] = [];
  for (const r of active.slice(0, limit)) out.push(...rewardBlocks(r, redeemable, ctx));
  if (active.length > limit && ctx.appUrl !== null) out.push(context(`<${ctx.appUrl}/shop|${t("seeAll", { count: active.length })}>`));
  return out;
}

export function shopMessage(rewards: readonly Reward[], redeemable: number, ctx: RenderContext): SlackMessageBody {
  const t = shop.t(ctx.locale);
  return msg(t("message.text", { amount: amount(ctx, redeemable) }), md(t("message.header", { amount: units(ctx, redeemable) })), ...shopBlocks(rewards, redeemable, ctx, 10));
}

export interface HomeData {
  readonly balances: Balances;
  readonly allowance: AllowanceView;
  /** S80: leaderboards by received, or null when giver mode hides them from the viewer (S81). */
  readonly leaderboard: { readonly month: readonly LeaderboardRow[]; readonly allTime: readonly LeaderboardRow[] } | null;
  readonly rewards: readonly Reward[];
  readonly level: { readonly level: number; readonly title: string } | null;
  /** S7: set for admins of a Free workspace over its member limit; absent or null shows nothing. */
  readonly upgradePrompt?: { readonly activeMembers: number; readonly limit: number } | null;
}

const MEDALS = [":first_place_medal:", ":second_place_medal:", ":third_place_medal:"];

function boardText(rows: readonly LeaderboardRow[], ctx: RenderContext): string {
  if (rows.length === 0) return home.t(ctx.locale)("noneYet", { plural: ctx.currency.plural });
  return rows.map((r) => `${MEDALS[r.rank - 1] ?? `${r.rank}.`} ${ctx.who(r.memberId)} · *${num(ctx, r.score)}*`).join("\n");
}

/** S28, S48: the App Home tab. */
export function homeView(d: HomeData, ctx: RenderContext): HomeView {
  const c = ctx.currency;
  const t = home.t(ctx.locale);
  const Plural = c.plural.charAt(0).toUpperCase() + c.plural.slice(1);
  const blocks: Block[] = [
    header(t("title", { emoji: c.primaryEmoji, plural: c.plural })),
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: t("received", { value: `${c.primaryEmoji} ${num(ctx, d.balances.received)}` }) },
        { type: "mrkdwn", text: t("given", { value: `${c.primaryEmoji} ${num(ctx, d.balances.given)}` }) },
        { type: "mrkdwn", text: t("spend", { value: `${c.primaryEmoji} ${num(ctx, d.balances.redeemable)}` }) },
        { type: "mrkdwn", text: t("left", { left: d.allowance.remaining, limit: d.allowance.limit }) },
      ],
    },
  ];
  if (d.level !== null) blocks.push(context(t("level", { level: d.level.level, title: escapeText(d.level.title) })));
  if (d.upgradePrompt != null) {
    const p = d.upgradePrompt;
    const link = ctx.appUrl === null ? t("upgradeNoLink") : `<${ctx.appUrl}/admin/billing|${t("upgradeLink")}>`;
    blocks.push(md(t("upgrade", { active: p.activeMembers, limit: p.limit, link })));
  }
  if (ctx.appUrl !== null) blocks.push(context(`<${ctx.appUrl}/app|${t("dashboard")}> · <${ctx.appUrl}/app/shop|${t("shopLink", { Plural })}>`));
  blocks.push(divider);
  if (d.leaderboard !== null) {
    blocks.push(header(t("leaderboard")));
    blocks.push({
      type: "section",
      fields: [
        { type: "mrkdwn", text: t("thisMonth", { rows: boardText(d.leaderboard.month, ctx) }) },
        { type: "mrkdwn", text: t("allTime", { rows: boardText(d.leaderboard.allTime, ctx) }) },
      ],
    });
    blocks.push(divider);
  }
  blocks.push(header(t("shop")));
  blocks.push(context(t("shopSpend", { amount: units(ctx, d.balances.redeemable) })));
  blocks.push(...shopBlocks(d.rewards, d.balances.redeemable, ctx, 6));
  blocks.push(divider);
  blocks.push(md(t("howTo", { emoji: c.primaryEmoji })));
  return { type: "home", blocks: blocks.slice(0, 100) };
}
