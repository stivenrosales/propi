// S98: token issue, revoke, list and authenticate. Decisions are core's; this wires the store,
// the clock, ids and the Crypto port.
import {
  authenticateToken,
  bearerToken,
  decideIssueToken,
  decideRevokeToken,
  parseToken,
  tokenView,
  type Actor,
  type ApiOutcome,
  type ApiTokenId,
  type ApiTokenRecord,
  type ApiTokenStore,
  type ApiTokenView,
  type Clock,
  type Crypto,
  type Ids,
  type IssueTokenInput,
  type WorkspaceId,
} from "@propi/core";

export interface ApiTokensDeps {
  readonly store: ApiTokenStore;
  readonly crypto: Crypto;
  readonly clock: Clock;
  readonly ids: Ids;
}

export interface ApiTokens {
  /** The plaintext `token` is returned here once and never again. */
  issue(actor: Actor, ws: WorkspaceId, input: IssueTokenInput): Promise<ApiOutcome<{ readonly token: string; readonly view: ApiTokenView }>>;
  revoke(actor: Actor, ws: WorkspaceId, id: ApiTokenId): Promise<ApiOutcome<ApiTokenView>>;
  list(ws: WorkspaceId): Promise<readonly ApiTokenView[]>;
  /** From an `Authorization: Bearer …` header value. */
  authenticate(authorization: string | undefined): Promise<ApiOutcome<{ readonly record: ApiTokenRecord; readonly actor: Actor }>>;
}

/** Secret entropy: 32 random bytes. */
const SECRET_BYTES = 32;

export function createApiTokens(deps: ApiTokensDeps): ApiTokens {
  return {
    async issue(actor, ws, input) {
      const generated = { id: deps.ids.next("apiToken") as ApiTokenId, secret: deps.crypto.randomToken(SECRET_BYTES) };
      const d = decideIssueToken(actor, ws, input, generated, deps.crypto, deps.clock.now());
      if (!d.ok) return d;
      await deps.store.save(d.value.record);
      return { ok: true, value: { token: d.value.token, view: tokenView(d.value.record) } };
    },

    async revoke(actor, ws, id) {
      const d = decideRevokeToken(actor, ws, await deps.store.get(id), deps.clock.now());
      if (!d.ok) return d;
      await deps.store.save(d.value);
      return { ok: true, value: tokenView(d.value) };
    },

    async list(ws) {
      return (await deps.store.list(ws)).map(tokenView);
    },

    async authenticate(authorization) {
      const presented = bearerToken(authorization);
      const parsed = presented === null ? null : parseToken(presented);
      const record = parsed === null ? null : await deps.store.get(parsed.id);
      return authenticateToken(presented, record, deps.crypto);
    },
  };
}
