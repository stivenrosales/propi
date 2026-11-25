// S97-S100: a framework-free REST handler. apps/web route handlers pass the request through and
// send back the response. Order: authenticate → match → scope → (write) idempotency key → command →
// execute. Every rule is core's; this only translates.
import {
  apiCommandKey,
  buildCommand,
  httpStatus,
  matchRoute,
  requireScope,
  type ApiError,
  type Directory,
  type LedgerEntry,
  type MemberId,
  type MemberRecord,
  type Reader,
  type WorkspaceId,
} from "@propi/core";
import type { App } from "../create-app.ts";
import type { ApiTokens } from "./tokens.ts";

export interface ApiRequest {
  readonly method: string;
  /** Path with optional query string, e.g. `/api/v1/members?limit=10`. */
  readonly path: string;
  /** Header names are matched case-insensitively. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface ApiResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface ApiReadContext {
  readonly workspaceId: WorkspaceId;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

/** A read endpoint. Returns the `data` to send, or null for 404. */
export type ApiReadHandler = (ctx: ApiReadContext) => Promise<unknown>;

export interface ApiHttpDeps {
  readonly app: App;
  readonly tokens: ApiTokens;
  readonly directory: Directory;
  readonly reader: Reader;
  /** Reads owned by other modules (gifts, rewards, redemptions, quests, leaderboards), by route id. */
  readonly readers?: Readonly<Record<string, ApiReadHandler>>;
}

export interface ApiHttp {
  handle(req: ApiRequest): Promise<ApiResponse>;
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

const fail = (error: ApiError | { readonly code: string }): ApiResponse => ({ status: httpStatus(error), headers: { ...JSON_HEADERS }, body: { error } });

function header(req: ApiRequest, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(req.headers)) if (k.toLowerCase() === lower) return v;
  return undefined;
}

function query(path: string): Record<string, string> {
  const q = path.split("?")[1];
  const out: Record<string, string> = {};
  if (q === undefined) return out;
  for (const pair of q.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const k = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
    out[k] = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
  }
  return out;
}

const memberJson = (r: MemberRecord) => ({ id: r.id, role: r.role, active: r.active, daily_limit_override: r.dailyLimitOverride });

const entryJson = (e: LedgerEntry) => ({
  seq: e.seq,
  command_key: e.commandKey,
  ordinal: e.ordinal,
  kind: e.kind,
  amount: e.amount,
  member_id: e.memberId,
  counterpart_id: e.counterpartId,
  cause: e.cause,
  source: e.source,
  allowance_day: e.allowanceDay,
  at: new Date(e.at).toISOString(),
  reason: e.reason,
});

/** The reads this module can answer from the existing ports. */
function builtInReaders(deps: ApiHttpDeps): Record<string, ApiReadHandler> {
  return {
    "members.list": async ({ workspaceId }) => (await deps.directory.members(workspaceId)).map(memberJson),
    "members.get": async ({ workspaceId, params }) => {
      const r = await deps.directory.member(workspaceId, (params["id"] ?? "") as MemberId);
      return r === null ? null : memberJson(r);
    },
    "balances.get": async ({ workspaceId, params }) => {
      const id = (params["id"] ?? "") as MemberId;
      if ((await deps.directory.member(workspaceId, id)) === null) return null;
      return deps.app.balances(workspaceId, id);
    },
    "ledger.list": async ({ workspaceId }) => (await deps.reader.workspace(workspaceId).entries()).map(entryJson),
  };
}

export function createApiHttp(deps: ApiHttpDeps): ApiHttp {
  const readers: Record<string, ApiReadHandler> = { ...builtInReaders(deps), ...deps.readers };

  return {
    async handle(req) {
      const auth = await deps.tokens.authenticate(header(req, "authorization"));
      if (!auth.ok) return fail(auth.error);
      const { record, actor } = auth.value;
      const workspaceId = record.workspaceId; // S98: the token's workspace, never the request's

      const match = matchRoute(req.method, req.path);
      if (match === null) return fail({ code: "route_not_found" });
      const allowed = requireScope(actor, match.route.scope);
      if (!allowed.ok) return fail(allowed.error);

      if (match.route.command === null) {
        const read = readers[match.route.id];
        if (read === undefined) return fail({ code: "not_implemented", route: match.route.id });
        const data = await read({ workspaceId, params: match.params, query: query(req.path) });
        if (data === null) return fail(match.route.resource === "members" || match.route.resource === "balances" ? { code: "unknown_member", memberId: (match.params["id"] ?? "") as MemberId } : { code: "route_not_found" });
        return { status: 200, headers: { ...JSON_HEADERS }, body: { data } };
      }

      // S100: Idempotency-Key → api:<tokenId>:<key>; execute() replays or reports idempotency_key_reused.
      const key = apiCommandKey(record.id, header(req, "idempotency-key"));
      if (!key.ok) return fail(key.error);
      const cmd = buildCommand(match, req.body, { key: key.value, workspaceId, actor });
      if (!cmd.ok) return fail(cmd.error);

      const result = await deps.app.executeAny(cmd.value);
      const replayed = { "idempotent-replayed": String(result.replayed) };
      if (!result.ok) return { ...fail(result.error), headers: { ...JSON_HEADERS, ...replayed } };
      return { status: 200, headers: { ...JSON_HEADERS, ...replayed }, body: { data: result.value } };
    },
  };
}
