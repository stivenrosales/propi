// In-memory API stores (S98, S99) for use-case tests: tokens, webhook endpoints, deliveries, a
// recording transport, and an outbox reader over the memory ports' committed events.
import {
  webhookEventId,
  type ApiTokenId,
  type ApiTokenRecord,
  type ApiTokenStore,
  type Delivery,
  type DeliveryStore,
  type OutboxEvent,
  type OutboxReader,
  type WebhookEndpoint,
  type WebhookEndpointStore,
  type WebhookRequest,
  type WebhookTransport,
  type WorkspaceId,
} from "@propi/core";
import type { MemoryPorts } from "./memory.ts";

const yieldNow = () => Promise.resolve();

export function createMemoryApiStores(mem: MemoryPorts) {
  const tokens = new Map<ApiTokenId, ApiTokenRecord>();
  const endpoints: WebhookEndpoint[] = [];
  const deliveries = new Map<string, Delivery>();
  const requests: WebhookRequest[] = [];

  const tokenStore: ApiTokenStore & { all(): readonly ApiTokenRecord[] } = {
    async get(id) {
      await yieldNow();
      return tokens.get(id) ?? null;
    },
    async list(ws) {
      await yieldNow();
      return [...tokens.values()].filter((t) => t.workspaceId === ws);
    },
    async save(record) {
      await yieldNow();
      tokens.set(record.id, record);
    },
    all: () => [...tokens.values()],
  };

  const endpointStore: WebhookEndpointStore & { add(ep: WebhookEndpoint): void } = {
    async list(ws) {
      await yieldNow();
      return endpoints.filter((e) => e.workspaceId === ws);
    },
    add: (ep) => void endpoints.push(ep),
  };

  const deliveryStore: DeliveryStore & { all(): readonly Delivery[] } = {
    async list(ws) {
      await yieldNow();
      return [...deliveries.values()].filter((d) => d.workspaceId === ws);
    },
    async insert(ds) {
      await yieldNow();
      for (const d of ds) if (!deliveries.has(d.id)) deliveries.set(d.id, d); // UNIQUE (event_id, destination)
    },
    async update(d) {
      await yieldNow();
      deliveries.set(d.id, d);
    },
    all: () => [...deliveries.values()],
  };

  /** Records every request; `respond` decides the answer (default 200). It may throw to simulate a network error. */
  const transport: WebhookTransport & { requests: WebhookRequest[]; respond: (req: WebhookRequest) => { status: number } } = {
    requests,
    respond: () => ({ status: 200 }),
    async post(req) {
      await yieldNow();
      requests.push(req);
      return transport.respond(req);
    },
  };

  /** The outbox as the relay reads it: committed domain events with a stable id. */
  const outbox: OutboxReader = {
    async events(ws: WorkspaceId): Promise<readonly OutboxEvent[]> {
      await yieldNow();
      return mem.events(ws).map((r) => {
        const { type, ...data } = r.event as { type: string } & Record<string, unknown>;
        return { id: webhookEventId(r.workspaceId, r.commandKey, r.ordinal), workspaceId: r.workspaceId, type, at: r.at, data };
      });
    },
  };

  return { tokens: tokenStore, endpoints: endpointStore, deliveries: deliveryStore, transport, outbox };
}

export type MemoryApiStores = ReturnType<typeof createMemoryApiStores>;
