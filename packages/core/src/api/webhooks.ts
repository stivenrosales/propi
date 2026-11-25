// S99: webhooks. The event catalog, the payload shape, the HMAC-SHA256 signature and the delivery
// plan (exponential backoff, dead after 12 attempts, deduplicated per event). Pure: signing takes the
// Crypto port as a parameter and time comes in as `now`.
import { sha256Hex } from "../migration/sha256.ts";
import type { CommandKey, Instant, WorkspaceId } from "../shared/types.ts";
import { constantTimeEqual, type Crypto } from "./crypto.ts";

/** S99 + S54: every event a webhook endpoint can receive. */
export const WEBHOOK_EVENT_TYPES = [
  // gifts
  "gift.given",
  "gift.reversed",
  // redemptions (S54)
  "redemption.created",
  "redemption.approved",
  "redemption.rejected",
  "redemption.cancelled",
  "redemption.fulfilled",
  // quest submissions
  "quest.submission.created",
  "quest.submission.approved",
  "quest.submission.rejected",
  // rule awards
  "rule.awarded",
  // member changes
  "member.created",
  "member.updated",
  "member.deactivated",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * Domain event type → public webhook type. Domain events absent here stay internal
 * (e.g. `gift.rejected` is a private notice to the giver, `adjustment.made` is the audit trail).
 * A module whose domain event name differs from its public name adds one line here.
 */
export const DOMAIN_TO_WEBHOOK: Readonly<Record<string, WebhookEventType>> = Object.fromEntries(WEBHOOK_EVENT_TYPES.map((t) => [t, t]));

export function webhookEventType(domainType: string): WebhookEventType | null {
  return Object.hasOwn(DOMAIN_TO_WEBHOOK, domainType) ? (DOMAIN_TO_WEBHOOK[domainType] ?? null) : null;
}

/**
 * A stable event id from the outbox position (workspace, command key, ordinal). A replayed command
 * emits nothing new (G2), and the same event always gets the same id, so receivers can dedupe on it.
 */
export function webhookEventId(ws: WorkspaceId, commandKey: CommandKey, ordinal: number): string {
  return `evt_${sha256Hex(`${ws}\n${commandKey}\n${ordinal}`).slice(0, 32)}`;
}

/** An outbox event as the relay reads it. */
export interface OutboxEvent {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  /** The domain event type. */
  readonly type: string;
  readonly at: Instant;
  readonly data: Readonly<Record<string, unknown>>;
}

/** S99: the payload shape every receiver gets. */
export interface WebhookPayload {
  readonly id: string;
  readonly type: WebhookEventType;
  readonly created_at: string;
  readonly workspace_id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export function webhookPayload(e: OutboxEvent): WebhookPayload | null {
  const type = webhookEventType(e.type);
  if (type === null) return null;
  return { id: e.id, type, created_at: new Date(e.at).toISOString(), workspace_id: e.workspaceId, data: e.data };
}

/** The exact bytes that are signed and sent. */
export const webhookBody = (p: WebhookPayload): string => JSON.stringify(p);

export const SIGNATURE_HEADER = "X-Propi-Signature";
export const EVENT_ID_HEADER = "X-Propi-Event-Id";
/** Receivers should reject signatures older than this (replay protection). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** S99: `t=<unix seconds>,v1=<hex HMAC-SHA256 of t + "." + body>` with the endpoint's secret. */
export function signWebhook(crypto: Crypto, secret: string, body: string, now: Instant): string {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${crypto.hmacSha256Hex(secret, `${t}.${body}`)}`;
}

export type SignatureCheck = { readonly ok: true } | { readonly ok: false; readonly reason: "malformed" | "expired" | "mismatch" };

/** What a receiver does: parse the header, check freshness, recompute, compare in constant time. */
export function verifyWebhook(crypto: Crypto, secret: string, body: string, header: string, now: Instant, toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS): SignatureCheck {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t" && /^\d+$/.test(v)) t = Number(v);
    else if (k === "v1" && v !== "") v1.push(v);
  }
  if (t === null || v1.length === 0) return { ok: false, reason: "malformed" };
  if (Math.abs(Math.floor(now / 1000) - t) > toleranceSeconds) return { ok: false, reason: "expired" };
  const expected = crypto.hmacSha256Hex(secret, `${t}.${body}`);
  return v1.some((s) => constantTimeEqual(s, expected)) ? { ok: true } : { ok: false, reason: "mismatch" };
}

// ───────────── endpoints and the delivery plan ─────────────

export interface WebhookEndpoint {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly url: string;
  /** Per-endpoint signing secret. */
  readonly secret: string;
  /** Subscribed types; "*" means every catalog event. */
  readonly events: readonly WebhookEventType[] | "*";
  readonly active: boolean;
}

export type DeliveryStatus = "pending" | "done" | "dead";

export interface Delivery {
  /** `<eventId>|<endpointId>`: unique, so an event reaches an endpoint through one delivery only. */
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly eventId: string;
  readonly endpointId: string;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Instant;
  readonly lastError: string | null;
}

export const WEBHOOK_MAX_ATTEMPTS = 12;
export const WEBHOOK_FIRST_RETRY_MS = 60_000; // 1 min
export const WEBHOOK_MAX_RETRY_MS = 12 * 60 * 60_000; // 12 h

/** Delay before the next attempt after `failedAttempts` failures: 1, 2, 4 … min, capped at 12 h. */
export function retryDelayMs(failedAttempts: number): number {
  const n = Math.max(1, Math.floor(failedAttempts));
  return Math.min(WEBHOOK_FIRST_RETRY_MS * 2 ** (n - 1), WEBHOOK_MAX_RETRY_MS);
}

export const deliveryId = (eventId: string, endpointId: string): string => `${eventId}|${endpointId}`;

const subscribes = (ep: WebhookEndpoint, type: WebhookEventType): boolean => ep.events === "*" || ep.events.includes(type);

/**
 * S99: new deliveries for events not yet planned. One per (event id, endpoint): an event seen twice
 * (relay restart, duplicate read) never produces a second delivery.
 */
export function planDeliveries(events: readonly OutboxEvent[], endpoints: readonly WebhookEndpoint[], existing: ReadonlySet<string>, now: Instant): Delivery[] {
  const seen = new Set(existing);
  const out: Delivery[] = [];
  for (const e of events) {
    const type = webhookEventType(e.type);
    if (type === null) continue;
    for (const ep of endpoints) {
      if (!ep.active || ep.workspaceId !== e.workspaceId || !subscribes(ep, type)) continue;
      const id = deliveryId(e.id, ep.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, workspaceId: e.workspaceId, eventId: e.id, endpointId: ep.id, status: "pending", attempts: 0, nextAttemptAt: now, lastError: null });
    }
  }
  return out;
}

/** A delivery is due when pending and its time has come. */
export const isDue = (d: Delivery, now: Instant): boolean => d.status === "pending" && d.nextAttemptAt <= now;

export type AttemptResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * S99: the state after one attempt. Success is final (`done`). A failure schedules the next attempt with
 * backoff, and the 12th failure makes the delivery `dead`. Terminal deliveries never change.
 */
export function afterAttempt(d: Delivery, result: AttemptResult, now: Instant): Delivery {
  if (d.status !== "pending") return d;
  const attempts = d.attempts + 1;
  if (result.ok) return { ...d, status: "done", attempts, lastError: null };
  if (attempts >= WEBHOOK_MAX_ATTEMPTS) return { ...d, status: "dead", attempts, lastError: result.error };
  return { ...d, attempts, nextAttemptAt: (now + retryDelayMs(attempts)) as Instant, lastError: result.error };
}
