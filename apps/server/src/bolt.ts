// Bolt wiring: Socket Mode by default, HTTP when SLACK_SOCKET_MODE=false (needs the signing secret).
// G7: events are acknowledged only after execute() committed. Bolt acks Events API requests before
// listeners run, so deferEventAcks swaps the ack for a no-op and sends the real one after the
// listener finished. A thrown listener leaves the event unacknowledged: Slack retries and the
// command key replays (S17). execute() is one short transaction, well under Slack's 3 s budget.
import bolt from "@slack/bolt";
import type { App as BoltApp, CustomRoute, ReceiverEvent } from "@slack/bolt";
import type { SlackBlockAction, SlackEnvelope, SlackSlashCommand } from "@propi/slack";
import type { SlackConfig } from "./config.ts";
import type { SlackGateway } from "./gateway.ts";
import { handleAction, handleEvent, handleSlash, publishHome, type InboundDeps } from "./inbound.ts";

const { App, LogLevel } = bolt;

export function deferEventAcks(app: BoltApp): void {
  const original = app.processEvent.bind(app);
  app.processEvent = async (event: ReceiverEvent): Promise<void> => {
    if ((event.body as { type?: string } | undefined)?.type !== "event_callback") return original(event);
    const ack = event.ack;
    await original({ ...event, ack: async () => undefined });
    await ack();
  };
}

/**
 * S3: Bolt authorizes each request with the bot token of the request's team (its installation), so
 * one process serves every installed workspace. The app-level token stays shared (Socket Mode).
 */
export function boltAuthorize(gateway: SlackGateway) {
  return async (source: { teamId?: string | undefined }) => {
    const a = source.teamId === undefined ? null : await gateway.auth(source.teamId);
    if (a === null) throw new Error(`no active Propi installation for team ${source.teamId ?? "(none)"}`);
    return { botToken: a.botToken, ...(a.botUserId === null ? {} : { botUserId: a.botUserId }), teamId: a.teamId };
  };
}

export function createBoltApp(config: { readonly slack: SlackConfig; readonly port: number }, d: InboundDeps, routes: CustomRoute[]): BoltApp {
  const { slack } = config;
  const common = { authorize: boltAuthorize(d.slack), logLevel: LogLevel.INFO, customRoutes: routes, installerOptions: { port: config.port } };
  const app =
    slack.mode === "socket"
      ? new App({ ...common, socketMode: true, appToken: slack.appToken ?? "" })
      : new App({ ...common, signingSecret: slack.signingSecret ?? "", processBeforeResponse: true });
  deferEventAcks(app);

  const onEvent = async ({ body }: { body: unknown }) => {
    const started = Date.now();
    const out = await handleEvent(d, body as SlackEnvelope);
    const ms = Date.now() - started;
    if (ms > 1500) d.log("slow event", { ms, type: out.type ?? out.reason ?? "unknown" });
  };
  for (const name of ["message", "reaction_added", "reaction_removed", "app_home_opened", "app_uninstalled", "tokens_revoked", "user_change", "team_join"] as const) app.event(name, onEvent);

  app.command("/propi", async ({ ack, command }) => {
    const reply = await handleSlash(d, command as unknown as SlackSlashCommand);
    await ack({ response_type: "ephemeral", text: reply.text, blocks: reply.blocks as never });
  });

  app.action(/^propi_/, async ({ ack, body, respond }) => {
    await ack();
    const payload = body as unknown as SlackBlockAction & { response_url?: string };
    const r = await handleAction(d, payload);
    if (r === null) return;
    if (payload.response_url !== undefined) await respond({ response_type: "ephemeral", replace_original: false, text: r.text });
    else {
      const team = payload.team?.id ?? payload.user.team_id ?? "";
      const client = await d.slack.forTeam(team);
      if (client !== null) await client.postMessage(await client.openConversation([payload.user.id]), { text: r.text, blocks: [] });
    }
    if (r.refreshHome) await publishHome(d, payload.team?.id ?? payload.user.team_id ?? "", payload.user.id);
  });

  app.error(async (err) => {
    const code = (err as { code?: string }).code ?? null;
    d.log("bolt error", { error: err.message, code });
    // A team without an active installation will not get one by retrying: acknowledge and drop it.
    if (code === bolt.ErrorCode.AuthorizationError) return;
    throw err; // keeps the event unacknowledged (G7)
  });
  return app;
}
