// S99: the webhook relay. Reads the outbox, plans one delivery per (event, endpoint), sends what is
// due with a fresh signature, and records the attempt with core's backoff plan. Who gets what and when
// to retry are core decisions (planDeliveries, afterAttempt); this only moves bytes.
import {
  EVENT_ID_HEADER,
  SIGNATURE_HEADER,
  afterAttempt,
  isDue,
  planDeliveries,
  signWebhook,
  webhookBody,
  webhookPayload,
  type AttemptResult,
  type Clock,
  type Crypto,
  type DeliveryStore,
  type OutboxReader,
  type WebhookEndpointStore,
  type WebhookTransport,
  type WorkspaceId,
} from "@propi/core";

export interface WebhookRelayDeps {
  readonly outbox: OutboxReader;
  readonly endpoints: WebhookEndpointStore;
  readonly deliveries: DeliveryStore;
  readonly transport: WebhookTransport;
  readonly crypto: Crypto;
  readonly clock: Clock;
}

export interface RelaySummary {
  readonly planned: number;
  readonly attempted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly dead: number;
}

export interface WebhookRelay {
  /** One pass for a workspace: plan new deliveries, then attempt every due one. */
  tick(ws: WorkspaceId): Promise<RelaySummary>;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createWebhookRelay(deps: WebhookRelayDeps): WebhookRelay {
  return {
    async tick(ws) {
      const now = deps.clock.now();
      const events = await deps.outbox.events(ws);
      const endpoints = await deps.endpoints.list(ws);
      const existing = await deps.deliveries.list(ws);
      const planned = planDeliveries(events, endpoints, new Set(existing.map((d) => d.id)), now);
      if (planned.length > 0) await deps.deliveries.insert(planned);

      const byEvent = new Map(events.map((e) => [e.id, e]));
      const byEndpoint = new Map(endpoints.map((e) => [e.id, e]));
      let attempted = 0;
      let delivered = 0;
      let failed = 0;
      let dead = 0;

      for (const d of [...existing, ...planned]) {
        if (!isDue(d, now)) continue;
        const event = byEvent.get(d.eventId);
        const endpoint = byEndpoint.get(d.endpointId);
        const payload = event === undefined ? null : webhookPayload(event);
        let result: AttemptResult;
        if (payload === null || endpoint === undefined || !endpoint.active) {
          result = { ok: false, error: endpoint === undefined || !endpoint.active ? "endpoint_inactive" : "event_missing" };
        } else {
          const body = webhookBody(payload);
          const headers = {
            "Content-Type": "application/json",
            [EVENT_ID_HEADER]: payload.id,
            [SIGNATURE_HEADER]: signWebhook(deps.crypto, endpoint.secret, body, now), // signed per attempt: fresh timestamp
          };
          try {
            const res = await deps.transport.post({ url: endpoint.url, headers, body });
            result = res.status >= 200 && res.status < 300 ? { ok: true } : { ok: false, error: `http ${res.status}` };
          } catch (err) {
            result = { ok: false, error: errorText(err) };
          }
        }
        attempted++;
        const next = afterAttempt(d, result, now);
        await deps.deliveries.update(next);
        if (next.status === "done") delivered++;
        else if (next.status === "dead") dead++;
        else failed++;
      }
      return { planned: planned.length, attempted, delivered, failed, dead };
    },
  };
}
