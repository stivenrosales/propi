// S98: API tokens are workspace-scoped, carry explicit scopes, are revocable and are stored as a hash.
// Every check here is pure; hashing goes through the Crypto port passed in by the caller.
import type { Actor, ApiScope, ApiTokenId, Instant, WorkspaceId } from "../shared/types.ts";
import { constantTimeEqual, type Crypto } from "./crypto.ts";
import { apiFail, apiOk, type ApiOutcome } from "./errors.ts";

/** Every scope a token may carry. A token has exactly the scopes it was issued with. */
export const API_SCOPES: readonly ApiScope[] = [
  "members:read",
  "ledger:read",
  "rewards:read",
  "rewards:write",
  "redemptions:read",
  "redemptions:write",
  "adjustments:write",
  "quests:read",
  "leaderboards:read",
];

const TOKEN_PREFIX = "propi_";

/** A stored token. The plaintext is shown once at issue time and never stored. */
export interface ApiTokenRecord {
  readonly id: ApiTokenId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly scopes: readonly ApiScope[];
  /** SHA-256 hex of the full plaintext token. */
  readonly secretHash: string;
  readonly createdAt: Instant;
  readonly createdBy: Actor;
  readonly revokedAt: Instant | null;
}

/** The public view of a token: everything but the hash. */
export type ApiTokenView = Omit<ApiTokenRecord, "secretHash">;
export const tokenView = ({ secretHash: _h, ...view }: ApiTokenRecord): ApiTokenView => view;

/** Plaintext form: `propi_<tokenId>.<secret>`. The id lets the server find the record without scanning. */
export const formatToken = (id: ApiTokenId, secret: string): string => `${TOKEN_PREFIX}${id}.${secret}`;

export function parseToken(token: string): { readonly id: ApiTokenId; readonly secret: string } | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const rest = token.slice(TOKEN_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot === rest.length - 1) return null;
  return { id: rest.slice(0, dot) as ApiTokenId, secret: rest.slice(dot + 1) };
}

/** Bearer token from an `Authorization` header value, or null. */
export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m?.[1] ?? null;
}

/** Validates a requested scope list: known scopes only, at least one, deduplicated and sorted. */
export function parseScopes(input: readonly string[]): ApiOutcome<readonly ApiScope[]> {
  if (input.length === 0) return apiFail({ code: "invalid_request", field: "scopes" });
  for (const s of input) if (!(API_SCOPES as readonly string[]).includes(s)) return apiFail({ code: "invalid_scope", scope: s });
  return apiOk([...new Set(input as readonly ApiScope[])].sort());
}

export interface IssueTokenInput {
  readonly name: string;
  readonly scopes: readonly string[];
}

/** Only an admin member issues or revokes tokens; a token can never mint another token. */
const isAdmin = (actor: Actor): boolean => actor.kind === "member" && actor.role === "admin";

/** S98: decide a new token. `generated` comes from the app (id and random secret). */
export function decideIssueToken(
  actor: Actor,
  ws: WorkspaceId,
  input: IssueTokenInput,
  generated: { readonly id: ApiTokenId; readonly secret: string },
  crypto: Crypto,
  now: Instant,
): ApiOutcome<{ readonly token: string; readonly record: ApiTokenRecord }> {
  if (!isAdmin(actor)) return apiFail({ code: "forbidden", need: "admin" });
  if (input.name.trim() === "") return apiFail({ code: "invalid_request", field: "name" });
  const scopes = parseScopes(input.scopes);
  if (!scopes.ok) return scopes;
  const token = formatToken(generated.id, generated.secret);
  return apiOk({
    token,
    record: { id: generated.id, workspaceId: ws, name: input.name.trim(), scopes: scopes.value, secretHash: crypto.sha256Hex(token), createdAt: now, createdBy: actor, revokedAt: null },
  });
}

/** S98: revoke a token. Revoking an already revoked token is a no-op that keeps the first revocation time. */
export function decideRevokeToken(actor: Actor, ws: WorkspaceId, record: ApiTokenRecord | null, now: Instant): ApiOutcome<ApiTokenRecord> {
  if (!isAdmin(actor)) return apiFail({ code: "forbidden", need: "admin" });
  if (record === null || record.workspaceId !== ws) return apiFail({ code: "token_not_found" });
  if (record.revokedAt !== null) return apiOk(record);
  return apiOk({ ...record, revokedAt: now });
}

/** S98: every write made with a token records the token itself as the actor. */
export const tokenActor = (record: ApiTokenRecord): Actor => ({ kind: "apiToken", tokenId: record.id, scopes: record.scopes });

/**
 * S98: authenticate a presented plaintext token against its stored record.
 * The workspace comes from the record, never from the request: a token only ever acts on its own workspace.
 */
export function authenticateToken(presented: string | null, record: ApiTokenRecord | null, crypto: Crypto): ApiOutcome<{ readonly record: ApiTokenRecord; readonly actor: Actor }> {
  if (presented === null || record === null) return apiFail({ code: "unauthenticated" });
  const parsed = parseToken(presented);
  if (parsed === null || parsed.id !== record.id) return apiFail({ code: "unauthenticated" });
  if (!constantTimeEqual(crypto.sha256Hex(presented), record.secretHash)) return apiFail({ code: "unauthenticated" });
  if (record.revokedAt !== null) return apiFail({ code: "token_revoked" });
  return apiOk({ record, actor: tokenActor(record) });
}

/** S98: a pure scope check. Only token actors carry scopes; other actors are not API callers. */
export function requireScope(actor: Actor, need: ApiScope): ApiOutcome<Actor> {
  if (actor.kind === "apiToken" && actor.scopes.includes(need)) return apiOk(actor);
  return apiFail({ code: "forbidden", need });
}
