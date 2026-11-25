// The outbox relay (architecture §6): committed domain events → Slack DMs/posts (S29, S54, S61,
// S83, S85, S93, S95), quest auto-triggers (S68) and signed webhook deliveries (S99).
// Who gets what is core's decision (notify plans, event `notify` lists, canApprove); this moves bytes.
// Each consumer claims events with a receipt in the same transaction: a crash before the receipt
// redelivers (at-least-once to Slack), a replayed command never emits again (exactly-once into the outbox).
import {
  asShop,
  canApprove,
  createWebhookRelay,
  nodeCrypto,
  questCommandsForEvent,
  type CommandKey,
  type DomainEvent,
  type MemberId,
  type OutboxEvent,
  type WebhookTransport,
  type WorkspaceId,
} from "@propi/app";
import {
  celebrationMessage,
  collabMessage,
  digestMessage,
  notificationMessage,
  pairingMessage,
  questMessage,
  reciprocityMessage,
  redemptionApprovalMessage,
  redemptionMessage,
  ruleAwardMessage,
  submissionApprovalMessage,
  type RenderContext,
  type SlackMessageBody,
} from "@propi/slack";
import { renderContext, type Log } from "./inbound.ts";
import { NOTIFY_EVENT, type ServerNotification } from "./jobs.ts";
import type { ServerLookup } from "./lookup.ts";
import type { Runtime } from "./runtime.ts";
import { isPermanentSlackError, type SlackApi } from "./slack-api.ts";

export type SlackTarget =
  | { readonly kind: "dm"; readonly to: MemberId }
  | { readonly kind: "channel"; readonly channel: string }
  | { readonly kind: "group"; readonly members: readonly MemberId[] };

export interface SlackDelivery {
  readonly target: SlackTarget;
  readonly body: SlackMessageBody;
}

export interface RelayDeps {
  readonly rt: Runtime;
  readonly lookup: ServerLookup;
  readonly slack: SlackApi;
  readonly appUrl: string | null;
  readonly log: Log;
}

const dm = (to: MemberId, body: SlackMessageBody): SlackDelivery => ({ target: { kind: "dm", to }, body });

function serverNotification(n: ServerNotification, ctx: RenderContext): SlackDelivery {
  switch (n.type) {
    case "reciprocity_review":
      return dm(n.to, reciprocityMessage(n.pairs, n.period, ctx));
    case "monthly_digest":
      return dm(n.to, digestMessage({ month: n.month, team: n.team }, ctx));
    default:
      return dm(n.to, notificationMessage(n, ctx));
  }
}

/** The Slack messages one outbox event produces. */
export async function slackDeliveriesFor(d: Pick<RelayDeps, "rt">, ev: OutboxEvent, ctx: RenderContext): Promise<SlackDelivery[]> {
  const ws = ev.workspaceId;
  const data = ev.data as Record<string, unknown>;
  const event = { type: ev.type, ...data } as unknown as DomainEvent;
  const shop = () => asShop(d.rt.ports.reader.workspace(ws));
  const approvers = async () => (await d.rt.ports.directory.members(ws)).filter((r) => r.active && canApprove({ kind: "member", memberId: r.id, role: r.role })).map((r) => r.id);

  if (ev.type === NOTIFY_EVENT) return [serverNotification(data["notification"] as ServerNotification, ctx)];

  switch (event.type) {
    case "gift.given":
    case "gift.rejected":
    case "adjustment.made":
      return (await d.rt.notify.eventNotifications(ws, event)).map((n) => dm(n.to, notificationMessage(n, ctx)));
    case "redemption.created":
    case "redemption.approved":
    case "redemption.rejected":
    case "redemption.cancelled":
    case "redemption.fulfilled": {
      const reward = event.rewardId === null ? null : await shop().reward(event.rewardId);
      const title = reward?.title ?? null;
      const out = event.notify.map((to) => dm(to, redemptionMessage({ type: event.type, cost: event.cost, rewardTitle: title }, ctx)));
      if (event.type === "redemption.created") {
        const r = await shop().redemption(event.redemptionId);
        if (r?.state === "pending") {
          for (const to of await approvers()) out.push(dm(to, redemptionApprovalMessage({ redemptionId: r.id, member: r.memberId, rewardTitle: title, cost: r.cost }, ctx)));
        }
      }
      return out;
    }
    case "quest.submitted": {
      if (event.state !== "pending") return [];
      const quest = await d.rt.engagement.quests.quest(ws, event.questId);
      return (await approvers()).map((to) => dm(to, submissionApprovalMessage({ submissionId: event.submissionId, member: event.memberId, questTitle: quest?.title ?? null }, ctx)));
    }
    case "quest.approved":
    case "quest.rejected": {
      const quest = await d.rt.engagement.quests.quest(ws, event.questId);
      return [dm(event.memberId, questMessage(event.type === "quest.approved" ? { type: event.type, amount: event.amount } : { type: event.type }, quest?.title ?? null, ctx))];
    }
    case "collab.completed":
      return event.notify.map((to) => dm(to, collabMessage({ type: event.type }, ctx)));
    case "collab.refunded":
      return event.notify.map((to) => dm(to, collabMessage({ type: event.type, total: event.total }, ctx)));
    case "rule.awarded":
      return event.announceChannel === null ? [] : [{ target: { kind: "channel", channel: event.announceChannel }, body: ruleAwardMessage(event, ctx) }];
    case "milestone.celebrated": {
      const body = celebrationMessage(event, ctx);
      if (event.post === "channel" && event.channelId !== null) return [{ target: { kind: "channel", channel: event.channelId }, body }];
      if (event.post === "dm") return [dm(event.memberId, body)];
      return [];
    }
    case "pairing.round":
      return event.groups.map((members) => ({ target: { kind: "group", members }, body: pairingMessage(event, members, ctx) }));
    default:
      return [];
  }
}

/** Sends one delivery. Permanent failures (no such user, archived channel) are logged and skipped. */
export async function sendDelivery(d: RelayDeps, ws: WorkspaceId, del: SlackDelivery): Promise<"sent" | "skipped"> {
  try {
    let channel: string;
    if (del.target.kind === "channel") channel = del.target.channel;
    else {
      const members = del.target.kind === "dm" ? [del.target.to] : del.target.members;
      const users: string[] = [];
      for (const m of members) {
        const u = await d.lookup.slackUserOf(ws, m);
        if (u !== null) users.push(u);
      }
      if (users.length === 0 || (del.target.kind === "group" && users.length < 2)) return "skipped";
      channel = await d.slack.openConversation(users);
    }
    await d.slack.postMessage(channel, del.body);
    return "sent";
  } catch (err) {
    if (isPermanentSlackError(err)) {
      d.log("slack delivery skipped", { error: (err as { data?: { error?: string } }).data?.error });
      return "skipped";
    }
    throw err;
  }
}

export interface RelayPass {
  readonly slackEvents: number;
  readonly slackSent: number;
  readonly questEvents: number;
  readonly questSubmissions: number;
}

export const SLACK_CONSUMER = "slack";
export const QUEST_CONSUMER = "quest-triggers";

/** One relay pass over every workspace's new events. Returns what it did, for logs and tests. */
export async function relayOnce(d: RelayDeps, opts: { readonly limit?: number } = {}): Promise<RelayPass> {
  const limit = opts.limit ?? 20;
  const contexts = new Map<WorkspaceId, RenderContext>();
  const ctxFor = async (ws: WorkspaceId) => contexts.get(ws) ?? contexts.set(ws, await renderContext(d, ws)).get(ws)!;

  const slack = await d.rt.api.outbox.claimEvents(
    SLACK_CONSUMER,
    async (events) => {
      let sent = 0;
      for (const ev of events) {
        for (const del of await slackDeliveriesFor(d, ev, await ctxFor(ev.workspaceId))) if ((await sendDelivery(d, ev.workspaceId, del)) === "sent") sent++;
      }
      return sent;
    },
    { limit },
  );

  // S68: quest auto-triggers. The trigger key uses the event's stable outbox id, so a redelivery replays.
  const quests = await d.rt.api.outbox.claimEvents(
    QUEST_CONSUMER,
    async (events) => {
      let n = 0;
      for (const ev of events) {
        const cmds = await questCommandsForEvent(d.rt.engagement, { workspaceId: ev.workspaceId, commandKey: ev.id as CommandKey, at: ev.at, event: { type: ev.type, ...ev.data } });
        for (const c of cmds) {
          const r = await d.rt.app.execute(c);
          if (r.ok && !r.replayed) n++;
        }
      }
      return n;
    },
    { limit: 100 },
  );
  return { slackEvents: slack.claimed, slackSent: slack.result, questEvents: quests.claimed, questSubmissions: quests.result };
}

/** S99: webhook POSTs with a timeout; the relay records the attempt with core's backoff. */
export const fetchTransport = (timeoutMs = 10_000): WebhookTransport => ({
  async post(req) {
    const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    return { status: res.status };
  },
});

export function webhookRelay(rt: Runtime, transport: WebhookTransport = fetchTransport()) {
  return createWebhookRelay({ outbox: rt.api.outbox, endpoints: rt.api.endpoints, deliveries: rt.api.deliveries, transport, crypto: nodeCrypto, clock: rt.ports.clock });
}
