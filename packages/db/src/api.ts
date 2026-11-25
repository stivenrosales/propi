// Postgres stores for the API module (S98, S99): API tokens, webhook endpoints, webhook deliveries
// and the domain_event outbox reader. Same contracts as app/testing/api.ts; every decision (scopes,
// hashing, who gets which event, backoff) stays in core and app.
//
// Two replicas can relay safely:
// - `outbox.claimEvents` hands each consumer a batch of events no other transaction holds
//   (FOR NO KEY UPDATE SKIP LOCKED) and records a receipt in the same transaction, so every event is
//   handled once per consumer. NO KEY UPDATE, not UPDATE: delivery rows reference the event with a
//   foreign key (KEY SHARE), and those inserts must not wait on the claim that is creating them.
// - `deliveries.claimDue` leases due deliveries (SKIP LOCKED, then next_attempt_at = lease end); a
//   crashed replica's lease simply expires and the delivery becomes due again.
import {
  webhookEventId,
  type ApiScope,
  type ApiTokenId,
  type ApiTokenRecord,
  type ApiTokenStore,
  type CommandKey,
  type Delivery,
  type DeliveryStatus,
  type DeliveryStore,
  type Instant,
  type OutboxEvent,
  type OutboxReader,
  type WebhookEndpoint,
  type WebhookEndpointStore,
  type WorkspaceId,
} from "@propi/core";
import { Prisma, type PrismaClient } from "./client.ts";
import type { SecretCipher } from "./crypto.ts";
import { toJson } from "./settings-json.ts";

// ───────────── API tokens (S98) ─────────────

interface TokenRow {
  id: string;
  workspace_id: string;
  name: string;
  scopes: string[];
  secret_hash: string;
  created_at: Date;
  created_by: ApiTokenRecord["createdBy"];
  revoked_at: Date | null;
}

const toToken = (r: TokenRow): ApiTokenRecord => ({
  id: r.id as ApiTokenId,
  workspaceId: r.workspace_id as WorkspaceId,
  name: r.name,
  scopes: r.scopes as ApiScope[],
  secretHash: r.secret_hash,
  createdAt: r.created_at.getTime() as Instant,
  createdBy: r.created_by,
  revokedAt: r.revoked_at === null ? null : (r.revoked_at.getTime() as Instant),
});

const TOKEN_SELECT = Prisma.sql`SELECT id, workspace_id, name, scopes, secret_hash, created_at, created_by, revoked_at FROM api_token`;

export function createDbApiTokenStore(prisma: PrismaClient): ApiTokenStore {
  return {
    async get(id) {
      const [row] = await prisma.$queryRaw<TokenRow[]>`${TOKEN_SELECT} WHERE id = ${id}`;
      return row ? toToken(row) : null;
    },
    async list(ws) {
      return (await prisma.$queryRaw<TokenRow[]>`${TOKEN_SELECT} WHERE workspace_id = ${ws} ORDER BY seq`).map(toToken);
    },
    // Insert, or replace name/scopes/revocation. A token never moves workspace or changes its hash,
    // and a revocation is never undone.
    async save(t) {
      const changed = await prisma.$executeRaw`
        INSERT INTO api_token (id, workspace_id, name, scopes, secret_hash, created_at, created_by, revoked_at)
        VALUES (${t.id}, ${t.workspaceId}, ${t.name}, ${[...t.scopes]}::text[], ${t.secretHash}, ${new Date(t.createdAt)},
                ${toJson(t.createdBy)}::jsonb, ${t.revokedAt === null ? null : new Date(t.revokedAt)})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, scopes = EXCLUDED.scopes, revoked_at = COALESCE(api_token.revoked_at, EXCLUDED.revoked_at)
        WHERE api_token.workspace_id = EXCLUDED.workspace_id AND api_token.secret_hash = EXCLUDED.secret_hash`;
      if (changed !== 1) throw new Error(`api token ${t.id} cannot change workspace or secret`);
    },
  };
}

// ───────────── Webhook endpoints (S99) ─────────────

export interface DbWebhookEndpointStore extends WebhookEndpointStore {
  get(ws: WorkspaceId, id: string): Promise<WebhookEndpoint | null>;
  /** Insert or replace an endpoint; the secret is encrypted before it reaches the database. */
  save(endpoint: WebhookEndpoint): Promise<void>;
}

interface EndpointRow {
  workspace_id: string;
  id: string;
  url: string;
  secret_enc: string;
  events: WebhookEndpoint["events"];
  active: boolean;
}

/** The associated data that binds an encrypted secret to its endpoint row. */
export const endpointSecretContext = (ws: WorkspaceId, id: string): string => `webhook:${ws}:${id}`;

export function createDbWebhookEndpointStore(prisma: PrismaClient, cipher: SecretCipher): DbWebhookEndpointStore {
  const toEndpoint = (r: EndpointRow): WebhookEndpoint => ({
    id: r.id,
    workspaceId: r.workspace_id as WorkspaceId,
    url: r.url,
    secret: cipher.decrypt(r.secret_enc, endpointSecretContext(r.workspace_id as WorkspaceId, r.id)),
    events: r.events,
    active: r.active,
  });
  const select = Prisma.sql`SELECT workspace_id, id, url, secret_enc, events, active FROM webhook_endpoint`;
  return {
    async list(ws) {
      return (await prisma.$queryRaw<EndpointRow[]>`${select} WHERE workspace_id = ${ws} ORDER BY seq`).map(toEndpoint);
    },
    async get(ws, id) {
      const [row] = await prisma.$queryRaw<EndpointRow[]>`${select} WHERE workspace_id = ${ws} AND id = ${id}`;
      return row ? toEndpoint(row) : null;
    },
    async save(e) {
      const secret = cipher.encrypt(e.secret, endpointSecretContext(e.workspaceId, e.id));
      await prisma.$executeRaw`
        INSERT INTO webhook_endpoint (workspace_id, id, url, secret_enc, events, active)
        VALUES (${e.workspaceId}, ${e.id}, ${e.url}, ${secret}, ${toJson(e.events)}::jsonb, ${e.active})
        ON CONFLICT (workspace_id, id) DO UPDATE SET
          url = EXCLUDED.url, secret_enc = EXCLUDED.secret_enc, events = EXCLUDED.events, active = EXCLUDED.active`;
    },
  };
}

// ───────────── Deliveries (S99) ─────────────

export interface ClaimDueOptions {
  readonly limit?: number;
  /** How long a claimed delivery stays hidden from other relays (ms). Default 60 s. */
  readonly leaseMs?: number;
  /** Only this workspace; all workspaces when absent. */
  readonly workspaceId?: WorkspaceId;
}

export interface DbDeliveryStore extends DeliveryStore {
  /**
   * Leases up to `limit` due deliveries (pending, next_attempt_at <= now) that no other relay holds.
   * Returns them as they were before the lease, so `isDue` and `afterAttempt` work unchanged; the
   * caller's `update` with the attempt result replaces the lease.
   */
  claimDue(now: Instant, opts?: ClaimDueOptions): Promise<Delivery[]>;
}

const WEBHOOK_DESTINATION = "webhook:";

interface DeliveryRow {
  id: string;
  workspace_id: string;
  event_id: string;
  destination: string;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
}

const toDelivery = (r: DeliveryRow): Delivery => ({
  id: r.id,
  workspaceId: r.workspace_id as WorkspaceId,
  eventId: r.event_id,
  endpointId: r.destination.slice(WEBHOOK_DESTINATION.length),
  status: r.status,
  attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at.getTime() as Instant,
  lastError: r.last_error,
});

export function createDbDeliveryStore(prisma: PrismaClient): DbDeliveryStore {
  return {
    async list(ws) {
      const rows = await prisma.$queryRaw<DeliveryRow[]>`
        SELECT id, workspace_id, event_id, destination, status, attempts, next_attempt_at, last_error
        FROM delivery WHERE workspace_id = ${ws} AND destination LIKE 'webhook:%' ORDER BY seq`;
      return rows.map(toDelivery);
    },
    // UNIQUE (event_id, destination) and the id key: a delivery planned twice is inserted once.
    async insert(ds) {
      if (ds.length === 0) return;
      const rows = ds.map(
        (d) => Prisma.sql`(${d.id}, ${d.workspaceId}, ${d.eventId}, ${WEBHOOK_DESTINATION + d.endpointId}, ${d.status}, ${d.attempts},
          ${new Date(d.nextAttemptAt)}, ${d.lastError})`,
      );
      await prisma.$executeRaw`
        INSERT INTO delivery (id, workspace_id, event_id, destination, status, attempts, next_attempt_at, last_error)
        VALUES ${Prisma.join(rows)} ON CONFLICT DO NOTHING`;
    },
    // Terminal deliveries never change (core afterAttempt), and a stale attempt count never wins.
    async update(d) {
      await prisma.$executeRaw`
        UPDATE delivery SET status = ${d.status}, attempts = ${d.attempts}, next_attempt_at = ${new Date(d.nextAttemptAt)}, last_error = ${d.lastError}
        WHERE id = ${d.id} AND status = 'pending' AND attempts <= ${d.attempts}`;
    },
    async claimDue(now, opts = {}) {
      const at = new Date(now);
      const leaseEnd = new Date(now + (opts.leaseMs ?? 60_000));
      const ws = opts.workspaceId === undefined ? Prisma.sql`` : Prisma.sql`AND workspace_id = ${opts.workspaceId}`;
      const rows = await prisma.$queryRaw<DeliveryRow[]>`
        WITH due AS (
          SELECT id, next_attempt_at FROM delivery
          WHERE status = 'pending' AND next_attempt_at <= ${at} AND destination LIKE 'webhook:%' ${ws}
          ORDER BY next_attempt_at, seq LIMIT ${opts.limit ?? 50}
          FOR UPDATE SKIP LOCKED)
        UPDATE delivery d SET next_attempt_at = ${leaseEnd} FROM due WHERE d.id = due.id
        RETURNING d.id, d.workspace_id, d.event_id, d.destination, d.status, d.attempts, due.next_attempt_at, d.last_error`;
      return rows.map(toDelivery).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
  };
}

// ───────────── Outbox (domain_event) ─────────────

export interface ClaimEventsOptions {
  readonly limit?: number;
  readonly workspaceId?: WorkspaceId;
  /** Max time the handler may run while the batch is held (ms). Default 30 s. */
  readonly timeoutMs?: number;
}

export interface DbOutboxReader extends OutboxReader {
  /**
   * Claims up to `limit` committed events that `consumer` has not handled yet and no other
   * transaction holds, in commit-sequence order, and runs `handle` on them. Receipts are written in
   * the same transaction: when `handle` throws, nothing is recorded and the events come back later.
   */
  claimEvents<T>(consumer: string, handle: (events: readonly OutboxEvent[]) => Promise<T>, opts?: ClaimEventsOptions): Promise<{ readonly claimed: number; readonly result: T }>;
}

interface EventRow {
  id: string;
  workspace_id: string;
  command_key: string;
  ordinal: number;
  at: Date;
  payload: { type: string } & Record<string, unknown>;
}

/** The outbox event as the relay reads it: the stable S99 id, the domain type, and the rest as data. */
function toOutboxEvent(r: EventRow): OutboxEvent {
  const { type, ...data } = r.payload;
  const ws = r.workspace_id as WorkspaceId;
  return { id: webhookEventId(ws, r.command_key as CommandKey, r.ordinal), workspaceId: ws, type, at: r.at.getTime() as Instant, data };
}

export function createDbOutboxReader(prisma: PrismaClient): DbOutboxReader {
  return {
    async events(ws) {
      const rows = await prisma.$queryRaw<EventRow[]>`
        SELECT id, workspace_id, command_key, ordinal, at, payload FROM domain_event WHERE workspace_id = ${ws} ORDER BY seq`;
      return rows.map(toOutboxEvent);
    },
    async claimEvents(consumer, handle, opts = {}) {
      const ws = opts.workspaceId === undefined ? Prisma.sql`` : Prisma.sql`AND e.workspace_id = ${opts.workspaceId}`;
      return prisma.$transaction(
        async (db) => {
          const rows = await db.$queryRaw<EventRow[]>`
            SELECT e.id, e.workspace_id, e.command_key, e.ordinal, e.at, e.payload FROM domain_event e
            WHERE NOT EXISTS (SELECT 1 FROM outbox_receipt r WHERE r.consumer = ${consumer} AND r.event_id = e.id) ${ws}
            ORDER BY e.seq LIMIT ${opts.limit ?? 100}
            FOR NO KEY UPDATE OF e SKIP LOCKED`;
          const result = await handle(rows.map(toOutboxEvent));
          if (rows.length > 0) {
            await db.$executeRaw`
              INSERT INTO outbox_receipt (consumer, event_id) VALUES ${Prisma.join(rows.map((r) => Prisma.sql`(${consumer}, ${r.id})`))}`;
          }
          return { claimed: rows.length, result };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: opts.timeoutMs ?? 30_000 },
      );
    },
  };
}

// ───────────── All API stores ─────────────

export interface DbApiStores {
  readonly tokens: ApiTokenStore;
  readonly endpoints: DbWebhookEndpointStore;
  readonly deliveries: DbDeliveryStore;
  readonly outbox: DbOutboxReader;
}

/**
 * The API ports over Postgres. Wire them at the composition root:
 *   createApiTokens({ store: stores.tokens, ... });
 *   createWebhookRelay({ outbox: stores.outbox, endpoints: stores.endpoints, deliveries: stores.deliveries, ... })
 */
export function createDbApiStores(prisma: PrismaClient, opts: { readonly cipher: SecretCipher }): DbApiStores {
  return {
    tokens: createDbApiTokenStore(prisma),
    endpoints: createDbWebhookEndpointStore(prisma, opts.cipher),
    deliveries: createDbDeliveryStore(prisma),
    outbox: createDbOutboxReader(prisma),
  };
}
