// Block Kit rendering for DMs, channel posts, the App Home and the /propi replies (S13, S28, S29,
// S48, S54, S61, S83, S84, S86, S89, S93, S95). Pure: data in, Slack message/view JSON out. Every
// unit name comes from the workspace currency (S1); nothing here is hard-coded to tacos.
import { formatUnits, type AllowanceView, type Balances, type Currency, type DomainError, type MemberId, type Reward } from "@propi/app";
import type { LeaderboardRow } from "@propi/core/boards";
import type { Notification } from "@propi/core/notify";
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

const units = (ctx: RenderContext, n: number) => `${ctx.currency.primaryEmoji} ${formatUnits(ctx.currency, n)}`;

/** Slack mrkdwn escaping for user-provided text. */
export const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** S13 and friends: a refusal in plain words. */
export function errorText(error: DomainError, ctx: RenderContext): string {
  switch (error.code) {
    case "over_allowance":
      return `That would cost ${formatUnits(ctx.currency, error.cost)}, but you have ${formatUnits(ctx.currency, error.remaining)} left to give today. Mention fewer people or use fewer ${ctx.currency.plural}; your allowance resets at midnight.`;
    case "channel_not_allowed":
      return `${ctx.currency.plural} can't be given in this conversation. Try a public channel.`;
    case "inactive_member":
      return "Your account is deactivated in this workspace.";
    case "bots_may_not_give":
      return "Bots can't give in this workspace.";
    case "insufficient_redeemable":
      return `That reward costs ${formatUnits(ctx.currency, error.cost)} and you have ${formatUnits(ctx.currency, error.redeemable)} to spend.`;
    case "out_of_stock":
      return "That reward is out of stock.";
    case "budget_exceeded":
      return "The shop's monthly budget is used up. Try again next month.";
    case "plan_limit":
      return "Your workspace is over the Free plan limit. Ask an admin to upgrade to Pro.";
    case "reward_not_active":
    case "reward_not_found":
      return "That reward is no longer available.";
    case "forbidden":
      return "You don't have permission to do that.";
    case "illegal_transition":
      return `That redemption is already ${error.from}.`;
    case "idempotency_key_reused":
      return "That was already handled.";
    default:
      return `That didn't work (${error.code}).`;
  }
}

/** S29, S83, S13, S84, S86, S89: one private notification. */
export function notificationMessage(n: Notification, ctx: RenderContext): SlackMessageBody {
  switch (n.type) {
    case "gift_confirmation": {
      const left = n.remainingAllowance === null ? "" : ` You have ${formatUnits(ctx.currency, n.remainingAllowance)} left to give today.`;
      return msg(`You gave ${units(ctx, n.totalCost)}.${left}`);
    }
    case "gift_received": {
      const where = n.channelId === null ? "" : ` in <#${n.channelId}>`;
      const quote = n.text === null || n.text === "" ? [] : [context(`> ${escapeText(n.text).replace(/\n/g, "\n> ")}`)];
      const text = `${ctx.who(n.giver)} gave you ${units(ctx, n.amount)}${where}.`;
      return msg(text, md(text), ...quote);
    }
    case "gift_rejected":
      return msg(`Nothing was given. ${errorText(n.error, ctx)}`);
    case "adjustment": {
      const verb = n.kind === "bonus" ? "added" : "removed";
      return msg(`An admin ${verb} ${units(ctx, n.amount)}: ${escapeText(n.reason)}`);
    }
    case "weekly_report": {
      const r = n.report;
      const top = r.topGivers.length === 0 ? "nobody yet" : r.topGivers.map((g) => `${ctx.who(g.memberId)} (${g.units})`).join(", ");
      const gave = r.gaveTo.length === 0 ? "nobody this week" : r.gaveTo.map((g) => `${ctx.who(g.memberId)} (${g.units})`).join(", ");
      const shop = r.shopUrl ?? (ctx.appUrl === null ? null : `${ctx.appUrl}/shop`);
      const text = `Your week in ${ctx.currency.plural} (${r.week})`;
      return msg(
        text,
        header(text),
        md(`*Team this month:* ${formatUnits(ctx.currency, r.team.monthToDate)} (same point last month: ${r.team.lastMonthSamePoint})`),
        md(`*Top givers this week:* ${top}`),
        md(`*You gave this month:* ${formatUnits(ctx.currency, r.own.monthToDate)} (last month: ${r.own.lastMonthSamePoint})\n*You gave to:* ${gave}`),
        md(`*You can spend:* ${units(ctx, r.redeemable)}${shop === null ? "" : ` · <${shop}|Open the shop>`}`),
      );
    }
    case "nudge":
      return msg(`You still have ${formatUnits(ctx.currency, n.unused)} to give this week. Who helped you lately? Mention them with ${ctx.currency.primaryEmoji}.`);
    case "isolation_alert":
      return msg(`These people haven't received any ${ctx.currency.plural} in ${n.weeks} weeks: ${n.isolated.map((id) => ctx.who(id)).join(", ")}.`);
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
  const what = e.rewardTitle === null ? "your redemption" : `*${escapeText(unitsOf(e.rewardTitle, e.quantity))}*`;
  switch (e.type) {
    case "redemption.created":
      return msg(`You redeemed ${what} for ${units(ctx, e.cost)}. We'll let you know when it's approved.`);
    case "redemption.approved":
      return msg(`Your redemption of ${what} was approved.`);
    case "redemption.fulfilled":
      return msg(`Your redemption of ${what} was fulfilled. Enjoy!`);
    case "redemption.rejected":
      return msg(`Your redemption of ${what} was rejected. ${formatUnits(ctx.currency, e.cost)} went back to your balance.`);
    case "redemption.cancelled":
      return msg(`Your redemption of ${what} was cancelled. ${formatUnits(ctx.currency, e.cost)} went back to your balance.`);
  }
}

/** S6: the approver's request, with buttons that send TransitionRedemption. */
export function redemptionApprovalMessage(
  r: { readonly redemptionId: string; readonly member: MemberId | null; readonly rewardTitle: string | null; readonly cost: number; readonly quantity?: number },
  ctx: RenderContext,
): SlackMessageBody {
  const who = r.member === null ? "A group" : ctx.who(r.member);
  const text = `${who} redeemed ${r.rewardTitle === null ? "a reward" : `*${escapeText(unitsOf(r.rewardTitle, r.quantity))}*`} for ${units(ctx, r.cost)}.`;
  return msg(text, md(text), {
    type: "actions",
    elements: [button("Approve", ACTIONS.approveRedemption, r.redemptionId, "primary"), button("Reject", ACTIONS.rejectRedemption, r.redemptionId, "danger")],
  });
}

/** S6, S64: the approver's request for a quest submission. */
export function submissionApprovalMessage(s: { readonly submissionId: string; readonly member: MemberId; readonly questTitle: string | null }, ctx: RenderContext): SlackMessageBody {
  const text = `${ctx.who(s.member)} completed ${s.questTitle === null ? "a quest" : `*${escapeText(s.questTitle)}*`} and is waiting for review.`;
  return msg(text, md(text), {
    type: "actions",
    elements: [button("Approve", ACTIONS.approveSubmission, s.submissionId, "primary"), button("Reject", ACTIONS.rejectSubmission, s.submissionId, "danger")],
  });
}

/** The reply on a button press: what happened, privately. */
export function actionResultText(ok: boolean, okText: string, error: DomainError | null, ctx: RenderContext): string {
  return ok || error === null ? okText : errorText(error, ctx);
}

export const questMessage = (e: { readonly type: "quest.approved" | "quest.rejected"; readonly amount?: number }, title: string | null, ctx: RenderContext): SlackMessageBody =>
  e.type === "quest.approved"
    ? msg(`Your submission for ${title === null ? "a quest" : `*${escapeText(title)}*`} was approved${e.amount === undefined ? "" : `: ${units(ctx, e.amount)}`}.`)
    : msg(`Your submission for ${title === null ? "a quest" : `*${escapeText(title)}*`} was not approved this time.`);

/** S61: a rule award announcement. */
export const ruleAwardMessage = (e: { readonly winners: readonly MemberId[]; readonly amount: number; readonly period: string }, ctx: RenderContext): SlackMessageBody =>
  msg(`Award for ${e.period}: ${e.winners.map((w) => ctx.who(w)).join(", ")} get ${units(ctx, e.amount)}. Congratulations!`);

/** S93: a celebration post or DM. */
export function celebrationMessage(e: { readonly memberId: MemberId; readonly kind: string; readonly years: number | null }, ctx: RenderContext): SlackMessageBody {
  if (e.kind === "birthday") return msg(`:birthday: Happy birthday, ${ctx.who(e.memberId)}!`);
  const years = e.years === null ? "" : ` ${e.years} year${e.years === 1 ? "" : "s"}`;
  return msg(`:tada: Happy${years} work anniversary, ${ctx.who(e.memberId)}!`);
}

/** S95: the pairing group DM. */
export const pairingMessage = (e: { readonly groups: unknown; readonly prompt: string | null }, members: readonly MemberId[], ctx: RenderContext): SlackMessageBody =>
  msg(`Hi ${members.map((id) => ctx.who(id)).join(", ")}! You've been paired for a chat this round.${e.prompt === null ? "" : `\n> ${escapeText(e.prompt)}`}`);

/** S57, S58: collaborative reward outcomes for contributors. */
export function collabMessage(e: { readonly type: "collab.completed" | "collab.refunded"; readonly total?: number }, ctx: RenderContext): SlackMessageBody {
  return e.type === "collab.completed"
    ? msg("A group reward you contributed to reached its goal!")
    : msg(`A group reward you contributed to was closed before its goal. Your contribution went back to your balance${e.total === undefined ? "" : ` (${formatUnits(ctx.currency, e.total)} in total were refunded)`}.`);
}

/** S90 (admins): reciprocity pairs to review. */
export const reciprocityMessage = (pairs: readonly { readonly a: MemberId; readonly b: MemberId }[], period: string, ctx: RenderContext): SlackMessageBody =>
  msg(`Reciprocity check for ${period}: these pairs send most of their ${ctx.currency.plural} to each other. Nothing was blocked; please review.\n${pairs.map((p) => `• ${ctx.who(p.a)} ↔ ${ctx.who(p.b)}`).join("\n")}`);

/** S91 (admins): the monthly digest. */
export function digestMessage(d: { readonly month: string; readonly team: readonly { readonly title: string; readonly summary: string }[] }, ctx: RenderContext): SlackMessageBody {
  const text = `Recognition digest for ${d.month}`;
  const themes = d.team.length === 0 ? [md(`No ${ctx.currency.plural} with a message this month.`)] : d.team.map((t) => md(`*${escapeText(t.title)}*\n${escapeText(t.summary)}`));
  return msg(text, header(text), ...themes);
}

// ───────────── /propi, the shop and the App Home (S28, S48) ─────────────

export function balanceMessage(b: Balances, a: AllowanceView, ctx: RenderContext): SlackMessageBody {
  return msg(
    `You can spend ${formatUnits(ctx.currency, b.redeemable)} and give ${formatUnits(ctx.currency, a.remaining)} more today.`,
    md(`*You can spend:* ${units(ctx, b.redeemable)}\n*Left to give today:* ${formatUnits(ctx.currency, a.remaining)} of ${a.limit}\n*Received:* ${b.received} · *Given:* ${b.given}`),
  );
}

export function helpMessage(ctx: RenderContext): SlackMessageBody {
  const c = ctx.currency;
  return msg(
    "How Propi works",
    md(`*Give:* mention someone and add ${c.primaryEmoji} in a channel, e.g. \`@ana thanks for the review ${c.primaryEmoji}${c.primaryEmoji}\`. React with ${c.primaryEmoji} to give too.`),
    md("*Commands:*\n`/propi balance` your balance and what you can still give today\n`/propi shop` rewards you can redeem\n`/propi sticker <id> @someone` give a sticker (when stickers are on)\n`/propi help` this message"),
  );
}

/** S2: the most units the "Redeem more" picker offers; the web shop has no such cap. */
const PICKER_MAX = 10;

/**
 * S2: a static_select of 2..N units per available option (N capped by balance, stock and PICKER_MAX),
 * each label showing the total. Null when no option allows two units. Core stays the source of truth.
 */
function quantityPicker(r: Reward, options: readonly { label: string; rewardId: string; variantId: string | null; stock: number | null }[], redeemable: number, ctx: RenderContext): Block | null {
  const byBalance = Math.floor(redeemable / r.cost);
  const choices = options.flatMap((o) => {
    const max = Math.min(PICKER_MAX, byBalance, o.stock ?? PICKER_MAX);
    return Array.from({ length: Math.max(0, max - 1) }, (_, i) => i + 2).map((q) => ({
      text: { type: "plain_text", text: `${q} × ${o.label} · ${formatUnits(ctx.currency, r.cost * q)}`.slice(0, 75), emoji: true },
      value: redeemQuantityValue(o.rewardId, o.variantId, q),
    }));
  });
  if (choices.length === 0) return null;
  return {
    type: "static_select",
    action_id: ACTIONS.redeemQuantity,
    placeholder: { type: "plain_text", text: "Redeem more", emoji: true },
    options: choices.slice(0, 100),
    confirm: {
      type: "confirm" as const,
      title: { type: "plain_text", text: "Redeem several?" },
      text: { type: "mrkdwn", text: `Spend the total shown for *${escapeText(r.title)}*? One approval covers every unit.` },
      confirm: { type: "plain_text", text: "Redeem" },
      deny: { type: "plain_text", text: "Cancel" },
    },
  };
}

function rewardBlocks(r: Reward, redeemable: number, ctx: RenderContext): Block[] {
  const stock = r.variants.length === 0 && r.stock !== null ? ` · ${r.stock} left` : "";
  const desc = r.description === "" ? "" : `\n${escapeText(r.description)}`;
  const section: Block = { ...md(`*${escapeText(r.title)}* · ${units(ctx, r.cost)}${stock}${desc}`) };
  const affordable = redeemable >= r.cost;
  const confirm = (label: string): Block => ({
    type: "confirm" as const,
    title: { type: "plain_text", text: "Redeem?" },
    text: { type: "mrkdwn", text: `Spend ${formatUnits(ctx.currency, r.cost)} on *${escapeText(label)}*?` },
    confirm: { type: "plain_text", text: "Redeem" },
    deny: { type: "plain_text", text: "Cancel" },
  });
  const options =
    r.variants.length === 0
      ? [{ label: r.title, value: redeemValue(r.id, null), out: r.stock !== null && r.stock <= 0, variantId: null, stock: r.stock }]
      : r.variants.map((v) => ({ label: `${r.title} (${v.name})`, value: redeemValue(r.id, v.id), out: v.stock !== null && v.stock <= 0, name: v.name, variantId: v.id, stock: v.stock }));
  const available = options.filter((o) => !o.out).slice(0, 5);
  const buttons = available.map((o) => button("name" in o ? `Redeem ${o.name}` : "Redeem", ACTIONS.redeem, o.value, "primary", confirm(o.label)));
  if (!affordable || buttons.length === 0) return [section, context(buttons.length === 0 ? "Out of stock" : `You need ${formatUnits(ctx.currency, r.cost - redeemable)} more`)];
  const picker = quantityPicker(r, available.map((o) => ({ label: o.label, rewardId: r.id, variantId: o.variantId, stock: o.stock })), redeemable, ctx);
  return [section, { type: "actions", elements: picker === null ? buttons : [...buttons, picker] }];
}

export function shopBlocks(rewards: readonly Reward[], redeemable: number, ctx: RenderContext, limit = 15): Block[] {
  const active = rewards.filter((r) => r.status === "active");
  if (active.length === 0) return [md("The shop is empty for now.")];
  const out: Block[] = [];
  for (const r of active.slice(0, limit)) out.push(...rewardBlocks(r, redeemable, ctx));
  if (active.length > limit && ctx.appUrl !== null) out.push(context(`<${ctx.appUrl}/shop|See all ${active.length} rewards>`));
  return out;
}

export function shopMessage(rewards: readonly Reward[], redeemable: number, ctx: RenderContext): SlackMessageBody {
  return msg(`The shop. You can spend ${formatUnits(ctx.currency, redeemable)}.`, md(`*The shop* · you can spend ${units(ctx, redeemable)}`), ...shopBlocks(rewards, redeemable, ctx, 10));
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
  if (rows.length === 0) return `_No ${ctx.currency.plural} yet._`;
  return rows.map((r) => `${MEDALS[r.rank - 1] ?? `${r.rank}.`} ${ctx.who(r.memberId)} · *${r.score.toLocaleString("en-US")}*`).join("\n");
}

/** S28, S48: the App Home tab. */
export function homeView(d: HomeData, ctx: RenderContext): HomeView {
  const c = ctx.currency;
  const plural = c.plural.charAt(0).toUpperCase() + c.plural.slice(1);
  const blocks: Block[] = [
    header(`${c.primaryEmoji} Your ${c.plural}`),
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Received*\n${c.primaryEmoji} ${d.balances.received.toLocaleString("en-US")}` },
        { type: "mrkdwn", text: `*Given*\n${c.primaryEmoji} ${d.balances.given.toLocaleString("en-US")}` },
        { type: "mrkdwn", text: `*You can spend*\n${c.primaryEmoji} ${d.balances.redeemable.toLocaleString("en-US")}` },
        { type: "mrkdwn", text: `*Left to give today*\n${d.allowance.remaining} of ${d.allowance.limit}` },
      ],
    },
  ];
  if (d.level !== null) blocks.push(context(`:star: Level ${d.level.level} · ${escapeText(d.level.title)}`));
  if (d.upgradePrompt != null) {
    const p = d.upgradePrompt;
    const link = ctx.appUrl === null ? "Upgrade to Pro in the web admin" : `<${ctx.appUrl}/admin/billing|Upgrade to Pro>`;
    blocks.push(md(`:warning: *Your workspace is over the Free plan limit (${p.activeMembers} of ${p.limit} active members).* Recognition keeps working, but the shop takes no new redemptions. ${link}`));
  }
  if (ctx.appUrl !== null) blocks.push(context(`<${ctx.appUrl}/app|Open your dashboard> · <${ctx.appUrl}/app/shop|${plural} shop>`));
  blocks.push(divider);
  if (d.leaderboard !== null) {
    blocks.push(header(":trophy: Leaderboard"));
    blocks.push({
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*This month*\n${boardText(d.leaderboard.month, ctx)}` },
        { type: "mrkdwn", text: `*All time*\n${boardText(d.leaderboard.allTime, ctx)}` },
      ],
    });
    blocks.push(divider);
  }
  blocks.push(header(":shopping_bags: Shop"));
  blocks.push(context(`You can spend ${units(ctx, d.balances.redeemable)}`));
  blocks.push(...shopBlocks(d.rewards, d.balances.redeemable, ctx, 6));
  blocks.push(divider);
  blocks.push(
    md(`*How to give:* mention someone and add ${c.primaryEmoji} with a reason, e.g. \`@ana thanks for the review ${c.primaryEmoji}${c.primaryEmoji}\`, or react with ${c.primaryEmoji}. Type \`/propi help\` for more.`),
  );
  return { type: "home", blocks: blocks.slice(0, 100) };
}
