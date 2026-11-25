// Port types for the API module (G3). packages/app wires them; packages/db and apps/server implement them.
import type { ApiTokenId, WorkspaceId } from "../shared/types.ts";
import type { ApiTokenRecord } from "./tokens.ts";
import type { Delivery, OutboxEvent, WebhookEndpoint } from "./webhooks.ts";

export interface ApiTokenStore {
  /** By id across workspaces: the id comes from the presented token, the workspace from the record. */
  get(id: ApiTokenId): Promise<ApiTokenRecord | null>;
  list(ws: WorkspaceId): Promise<readonly ApiTokenRecord[]>;
  /** Insert or replace (revocation replaces the record with revokedAt set). */
  save(record: ApiTokenRecord): Promise<void>;
}

/** Read side of the `domain_event` outbox, in commit order. */
export interface OutboxReader {
  events(ws: WorkspaceId): Promise<readonly OutboxEvent[]>;
}

export interface WebhookEndpointStore {
  list(ws: WorkspaceId): Promise<readonly WebhookEndpoint[]>;
}

export interface DeliveryStore {
  list(ws: WorkspaceId): Promise<readonly Delivery[]>;
  /** Inserts new deliveries; an id that already exists is ignored (UNIQUE (event_id, destination)). */
  insert(deliveries: readonly Delivery[]): Promise<void>;
  update(delivery: Delivery): Promise<void>;
}

export interface WebhookRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Sends one HTTP POST. Resolves with the status code; rejects on a network error or timeout. */
export interface WebhookTransport {
  post(req: WebhookRequest): Promise<{ readonly status: number }>;
}
