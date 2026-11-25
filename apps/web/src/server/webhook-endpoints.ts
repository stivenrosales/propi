// S99: registering a webhook endpoint. Core has no decider for endpoint registration yet, so this keeps
// it to input checks plus a fresh per-endpoint secret, returned once to the caller.
import { WEBHOOK_EVENT_TYPES, type Actor, type Crypto, type Ids, type WebhookEndpoint, type WebhookEventType, type WorkspaceId } from "@propi/core";

export type EndpointOutcome =
  | { readonly ok: true; readonly value: { readonly endpoint: WebhookEndpoint; readonly secret: string } }
  | { readonly ok: false; readonly error: { readonly code: "forbidden"; readonly need: "admin" } | { readonly code: "invalid_field"; readonly field: string } };

export interface EndpointInput {
  readonly url: string;
  /** Empty means every event ("*"). */
  readonly events: readonly string[];
}

export function isWebhookUrl(url: string, allowHttp: boolean): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (allowHttp && u.protocol === "http:");
  } catch {
    return false;
  }
}

export async function registerEndpoint(
  deps: { readonly save: (e: WebhookEndpoint) => Promise<void>; readonly crypto: Crypto; readonly ids: Ids; readonly allowHttp: boolean },
  actor: Actor,
  ws: WorkspaceId,
  input: EndpointInput,
): Promise<EndpointOutcome> {
  if (actor.kind !== "member" || actor.role !== "admin") return { ok: false, error: { code: "forbidden", need: "admin" } };
  if (!isWebhookUrl(input.url, deps.allowHttp)) return { ok: false, error: { code: "invalid_field", field: "url" } };
  for (const e of input.events) if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(e)) return { ok: false, error: { code: "invalid_field", field: "events" } };
  const secret = `whsec_${deps.crypto.randomToken(32)}`;
  const endpoint: WebhookEndpoint = {
    id: deps.ids.next("webhookEndpoint"),
    workspaceId: ws,
    url: input.url,
    secret,
    events: input.events.length === 0 ? "*" : ([...new Set(input.events)] as WebhookEventType[]),
    active: true,
  };
  await deps.save(endpoint);
  return { ok: true, value: { endpoint, secret } };
}
