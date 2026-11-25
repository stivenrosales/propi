// Inbound Slack traffic → app.execute and Block Kit replies. Transport-free: bolt.ts wires these to
// Bolt, tests call them with recorded payloads. Per G7 the event handler finishes execute() before
// the event is acknowledged; a thrown error leaves it unacknowledged so Slack retries and
// command_log replays (S17).
import { asShop, memberLevel, rewardCatalog, type Actor, type AppCommand, type DomainError, type Instant, type MemberId, type Result, type WorkspaceId } from "@propi/app";
import {
  actionCommand,
  actionResultText,
  balanceMessage,
  errorText,
  helpMessage,
  homeView,
  parseSlash,
  shopMessage,
  stickerCommand,
  translateEvent,
  type RenderContext,
  type SlackBlockAction,
  type SlackEnvelope,
  type SlackMessageBody,
  type SlackSlashCommand,
} from "@propi/slack";
import type { ServerLookup } from "./lookup.ts";
import type { Runtime } from "./runtime.ts";
import { profileOf, type SlackApi, type SlackUserObject } from "./slack-api.ts";

export type Log = (msg: string, data?: Record<string, unknown>) => void;

export interface InboundDeps {
  readonly rt: Runtime;
  readonly lookup: ServerLookup;
  readonly slack: SlackApi;
  readonly appUrl: string | null;
  readonly log: Log;
}

/** Results that mean "nothing to do" for a chat event: no reply, no warning (S9, S23). */
const SILENT = new Set(["not_a_gift", "gift_closed", "gift_not_found"]);

export async function renderContext(d: Pick<InboundDeps, "rt" | "appUrl">, ws: WorkspaceId): Promise<RenderContext> {
  const [settings, identities] = await Promise.all([d.rt.ports.directory.settings(ws), d.rt.identityStore.list(ws)]);
  const slackUser = new Map(identities.filter((i) => i.platform === "slack").map((i) => [i.memberId, i.userId]));
  return {
    currency: settings.currency,
    who: (m: MemberId) => {
      const u = slackUser.get(m);
      return u === undefined ? "a teammate" : `<@${u}>`;
    },
    appUrl: d.appUrl,
  };
}

export interface EventOutcome {
  readonly handled: "command" | "ignored" | "lifecycle";
  readonly type?: string;
  readonly result?: Result<unknown>;
  readonly reason?: string;
}

/**
 * Message, reaction, edit and delete events (S9-S24, S42). Over-allowance (S13) is answered by the
 * outbox: core emits `gift.rejected`, and the relay DMs the giver once, even if Slack retries.
 */
export async function handleEvent(d: InboundDeps, body: SlackEnvelope): Promise<EventOutcome> {
  const type = body.event.type;
  if (type === "app_uninstalled" || type === "tokens_revoked") {
    await uninstall(d, body.team_id, (body.event_time ?? Date.now() / 1000) * 1000);
    return { handled: "lifecycle", type };
  }
  if (type === "app_home_opened") {
    const ev = body.event as { user: string; tab?: string };
    if (ev.tab === "home") await publishHome(d, body.team_id, ev.user);
    return { handled: "lifecycle", type };
  }
  if (type === "user_change" || type === "team_join") {
    // S6: keep the member's display name and avatar in step with Slack.
    const ws = await d.lookup.workspace(body.team_id);
    const u = (body.event as { user?: SlackUserObject & { id?: string; is_bot?: boolean; deleted?: boolean } }).user;
    if (ws !== null && u?.id !== undefined) {
      await d.lookup.profile(ws, body.team_id, { id: u.id, isBot: u.is_bot === true || u.id === "USLACKBOT", deleted: u.deleted === true, ...profileOf(u) });
    }
    return { handled: "lifecycle", type };
  }
  const t = await translateEvent(d.lookup, body);
  if (t.kind === "ignored") return { handled: "ignored", reason: t.reason };
  const result = await d.rt.app.execute(t.command);
  if (!result.ok && !SILENT.has(result.error.code)) d.log("event refused", { type: t.command.type, code: result.error.code });
  return { handled: "command", type: t.command.type, result };
}

/** S72: an uninstall keeps every row; it only stops the workspace from being served. */
export async function uninstall(d: Pick<InboundDeps, "rt" | "lookup" | "log">, team: string, atMs: number): Promise<void> {
  await d.rt.installations.markUninstalled("slack", team, Math.round(atMs) as Instant);
  d.lookup.invalidate();
  d.log("workspace uninstalled; data kept (S72)");
}

/** S28, S48, S80: the App Home tab with balance, remaining allowance, leaderboard and the shop. */
export async function homeFor(d: InboundDeps, ws: WorkspaceId, actor: Extract<Actor, { kind: "member" }>) {
  const ctx = await renderContext(d, ws);
  const shop = asShop(d.rt.ports.reader.workspace(ws));
  const [balances, allowance, month, allTime, rewards, level] = await Promise.all([
    d.rt.app.balances(ws, actor.memberId),
    d.rt.app.allowance(ws, actor.memberId),
    d.rt.boards.leaderboard(ws, actor, { board: "received", timeframe: { kind: "month" }, limit: 10 }),
    d.rt.boards.leaderboard(ws, actor, { board: "received", timeframe: { kind: "all" }, limit: 10 }),
    rewardCatalog(shop, actor),
    memberLevel({ reader: d.rt.ports.reader, levels: d.rt.engagement.levels }, ws, actor.memberId),
  ]);
  const leaderboard = month.ok && allTime.ok ? { month: month.value, allTime: allTime.value } : null;
  return homeView({ balances, allowance, leaderboard, rewards, level }, ctx);
}

export async function publishHome(d: InboundDeps, team: string, user: string): Promise<void> {
  const ws = await d.lookup.workspace(team);
  if (ws === null) return;
  const actor = await d.lookup.actor(ws, team, user);
  if (actor?.kind !== "member") return;
  await d.slack.publishHome(user, await homeFor(d, ws, actor));
}

/** `/propi …`: the reply is ephemeral, returned to Bolt's ack (within 3 s). */
export async function handleSlash(d: InboundDeps, cmd: SlackSlashCommand): Promise<SlackMessageBody> {
  const ws = await d.lookup.workspace(cmd.team_id);
  if (ws === null) return { text: "Propi is not installed in this workspace.", blocks: [] };
  const ctx = await renderContext(d, ws);
  const actor = await d.lookup.actor(ws, cmd.team_id, cmd.user_id);
  if (actor?.kind !== "member") return { text: "Only workspace members can use Propi.", blocks: [] };
  const intent = parseSlash(cmd.text);
  switch (intent.kind) {
    case "help":
      return helpMessage(ctx);
    case "balance":
      return balanceMessage(await d.rt.app.balances(ws, actor.memberId), await d.rt.app.allowance(ws, actor.memberId), ctx);
    case "shop": {
      const balances = await d.rt.app.balances(ws, actor.memberId);
      return shopMessage(await rewardCatalog(asShop(d.rt.ports.reader.workspace(ws)), actor), balances.redeemable, ctx);
    }
    case "sticker": {
      const command = await stickerCommand(d.lookup, ws, actor, cmd, intent, d.rt.ports.clock.now());
      const r = await d.rt.app.execute(command);
      const text = r.ok ? `Sticker sent: ${r.value.receivers.length} ${r.value.receivers.length === 1 ? "person" : "people"} got ${r.value.perReceiver} each.` : errorText(r.error, ctx);
      return { text, blocks: [] };
    }
  }
}

const okText = (cmd: AppCommand, r: Result<unknown>): string => {
  switch (cmd.type) {
    case "Redeem":
      return `Redeemed. ${r.ok ? `It's ${(r.value as { state: string }).state}.` : ""} You'll get a message as it moves along.`;
    case "TransitionRedemption":
      return `Done: the redemption is now ${r.ok ? (r.value as { state: string }).state : "updated"}.`;
    case "ReviewSubmission":
      return `Done: the submission is now ${r.ok ? (r.value as { state: string }).state : "reviewed"}.`;
    default:
      return "Done.";
  }
};

/** Buttons (S48 redeem, S6 approvals). Returns the private reply text, or null for a no-op. */
export async function handleAction(d: InboundDeps, payload: SlackBlockAction): Promise<{ readonly text: string; readonly ok: boolean; readonly refreshHome: boolean } | null> {
  const team = payload.team?.id ?? payload.user.team_id ?? "";
  const ws = await d.lookup.workspace(team);
  if (ws === null) return null;
  const actor = await d.lookup.actor(ws, team, payload.user.id);
  if (actor?.kind !== "member") return null;
  const cmd = actionCommand(payload, ws, actor, d.rt.ports.clock.now());
  if (cmd === null) return null;
  const r = await d.rt.app.execute(cmd);
  const ctx = await renderContext(d, ws);
  const error: DomainError | null = r.ok ? null : r.error;
  return { text: actionResultText(r.ok, okText(cmd, r), error, ctx), ok: r.ok, refreshHome: cmd.type === "Redeem" };
}
