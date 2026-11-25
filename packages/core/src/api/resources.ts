// S97: the REST resource list and the command each write maps to. Framework-free: an adapter
// matches a request here, then hands the built command to execute(). No business rule lives here;
// amounts, reasons and transitions are judged by the deciders the commands reach.
import type { Actor, ApiScope, CommandBase, CommandKey, MemberId, PosInt, WorkspaceId } from "../shared/types.ts";
import type { CreateReward, RewardChanges, RewardInput, RewardVariant, SetRewardStatus, TransitionRedemption, UpdateReward } from "../shop/types.ts";
import { apiFail, apiOk, type ApiOutcome } from "./errors.ts";
import { API_COMMAND_AT } from "./idempotency.ts";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiResource = "members" | "balances" | "gifts" | "ledger" | "rewards" | "redemptions" | "quests" | "leaderboards";

/** Redemption transitions the API may request (S49, S53). */
export type ApiRedemptionTransition = "approve" | "reject" | "fulfil";

export interface ApiRoute {
  readonly id: string;
  readonly method: HttpMethod;
  /** Path under the API base, with `:param` segments. */
  readonly path: string;
  readonly resource: ApiResource;
  readonly scope: ApiScope;
  /** The command type a write maps to; null for reads. */
  readonly command: string | null;
}

export const API_BASE = "/api/v1";

const read = (id: string, path: string, resource: ApiResource, scope: ApiScope): ApiRoute => ({ id, method: "GET", path, resource, scope, command: null });
const write = (id: string, method: HttpMethod, path: string, resource: ApiResource, scope: ApiScope, command: string): ApiRoute => ({ id, method, path, resource, scope, command });

/** S97: every endpoint. Reads cover the eight resources; writes are exactly the listed commands. */
export const API_ROUTES: readonly ApiRoute[] = [
  read("members.list", "/members", "members", "members:read"),
  read("members.get", "/members/:id", "members", "members:read"),
  read("balances.get", "/members/:id/balances", "balances", "ledger:read"),
  read("gifts.list", "/gifts", "gifts", "ledger:read"),
  read("ledger.list", "/ledger-entries", "ledger", "ledger:read"),
  read("rewards.list", "/rewards", "rewards", "rewards:read"),
  read("rewards.get", "/rewards/:id", "rewards", "rewards:read"),
  read("redemptions.list", "/redemptions", "redemptions", "redemptions:read"),
  read("redemptions.get", "/redemptions/:id", "redemptions", "redemptions:read"),
  read("quests.list", "/quests", "quests", "quests:read"),
  read("leaderboards.get", "/leaderboards/:board", "leaderboards", "leaderboards:read"),

  write("bonuses.create", "POST", "/bonuses", "ledger", "adjustments:write", "GrantBonus"),
  write("deductions.create", "POST", "/deductions", "ledger", "adjustments:write", "Deduct"),
  write("redemptions.approve", "POST", "/redemptions/:id/approve", "redemptions", "redemptions:write", "TransitionRedemption"),
  write("redemptions.reject", "POST", "/redemptions/:id/reject", "redemptions", "redemptions:write", "TransitionRedemption"),
  write("redemptions.fulfil", "POST", "/redemptions/:id/fulfil", "redemptions", "redemptions:write", "TransitionRedemption"),
  write("rewards.create", "POST", "/rewards", "rewards", "rewards:write", "CreateReward"),
  write("rewards.update", "PATCH", "/rewards/:id", "rewards", "rewards:write", "UpdateReward"),
  write("rewards.archive", "DELETE", "/rewards/:id", "rewards", "rewards:write", "SetRewardStatus"),
];

export interface RouteMatch {
  readonly route: ApiRoute;
  readonly params: Readonly<Record<string, string>>;
}

/** Match a method and a path (with or without the `/api/v1` base and query string). */
export function matchRoute(method: string, rawPath: string): RouteMatch | null {
  const path = rawPath.split("?")[0] ?? "";
  const rel = path.startsWith(API_BASE) ? path.slice(API_BASE.length) : path;
  const parts = rel.split("/").filter((p) => p !== "");
  for (const route of API_ROUTES) {
    if (route.method !== method.toUpperCase()) continue;
    const pattern = route.path.split("/").filter((p) => p !== "");
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i]!;
      const v = parts[i]!;
      if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(v);
      else if (p !== v) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

// ───────────── write commands the API produces ─────────────

/** S49-S53: owned by the shop module; the API only names the transition (never cancel). */
export type ApiTransitionRedemption = TransitionRedemption & { readonly transition: ApiRedemptionTransition };

/** S44, S45, S97: rewards CRUD produces the shop's own commands; the shop decider validates the values. */
export type ApiCreateReward = CreateReward;
export type ApiUpdateReward = UpdateReward;
/** DELETE archives (SetRewardStatus archived): an archived reward keeps its redemption history (S45). */
export type ApiArchiveReward = SetRewardStatus & { readonly status: "archived" };

export type ApiCommand = CommandBase & { readonly type: string };

export interface CommandContext {
  readonly key: CommandKey;
  readonly workspaceId: WorkspaceId;
  readonly actor: Actor;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isMoneyJson = (v: unknown): v is { minor: number; currency: string } => isRecord(v) && isNumber(v["minor"]) && isString(v["currency"]);
const isStockJson = (v: unknown): v is number | null => v === null || isNumber(v);

/** JSON field -> RewardInput field, with the JSON type check for each. Values are judged by the shop decider. */
const REWARD_FIELDS = {
  title: ["title", isString],
  description: ["description", isString],
  image: ["image", (v: unknown) => v === null || isString(v)],
  cost: ["cost", isNumber],
  stock: ["stock", isStockJson],
  variants: ["variants", (v: unknown) => Array.isArray(v) && v.every((x) => isRecord(x) && isString(x["id"]) && isString(x["name"]) && isStockJson(x["stock"] ?? null))],
  categories: ["categories", (v: unknown) => Array.isArray(v) && v.every(isString)],
  internal_cost: ["internalCost", (v: unknown) => v === null || isMoneyJson(v)],
  instructions: ["instructions", isString],
  auto_approve: ["autoApprove", (v: unknown) => v === null || isBool(v)],
  gift_card: ["giftCard", isBool],
} as const satisfies Record<string, readonly [keyof RewardInput, (v: unknown) => boolean]>;

/** PATCH may change these; stock goes through restocks and status through archive (S45, S46). */
const EDITABLE = new Set<string>(["title", "description", "image", "cost", "categories", "internal_cost", "instructions", "auto_approve"]);

function rewardFields(b: Record<string, unknown>, allowed: (field: string) => boolean): ApiOutcome<Partial<Record<keyof RewardInput, unknown>>> {
  const out: Partial<Record<keyof RewardInput, unknown>> = {};
  for (const [field, value] of Object.entries(b)) {
    const spec = (REWARD_FIELDS as Record<string, readonly [keyof RewardInput, (v: unknown) => boolean]>)[field];
    if (spec === undefined || !allowed(field) || !spec[1](value)) return apiFail({ code: "invalid_request", field });
    out[spec[0]] = field === "variants" ? (value as Record<string, unknown>[]).map((x): RewardVariant => ({ id: x["id"] as string, name: x["name"] as string, stock: (x["stock"] ?? null) as number | null })) : value;
  }
  return apiOk(out);
}

/**
 * S97: translate a matched write into its command. Only JSON shape is checked here (types of fields);
 * whether an amount is positive or a reason present is the decider's call, so the API and Slack agree.
 */
export function buildCommand(match: RouteMatch, body: unknown, ctx: CommandContext): ApiOutcome<ApiCommand> {
  const base = { key: ctx.key, workspaceId: ctx.workspaceId, actor: ctx.actor, at: API_COMMAND_AT };
  const b = body ?? {};
  if (!isRecord(b)) return apiFail({ code: "invalid_request", field: "body" });
  const id = match.params["id"] ?? "";

  switch (match.route.id) {
    case "bonuses.create": {
      const ids = b["member_ids"];
      if (!Array.isArray(ids) || !ids.every(isString)) return apiFail({ code: "invalid_request", field: "member_ids" });
      if (!isNumber(b["amount"])) return apiFail({ code: "invalid_request", field: "amount" });
      if (!isString(b["reason"])) return apiFail({ code: "invalid_request", field: "reason" });
      return apiOk({ ...base, type: "GrantBonus", memberIds: ids as MemberId[], amount: b["amount"] as PosInt, reason: b["reason"] });
    }
    case "deductions.create": {
      if (!isString(b["member_id"])) return apiFail({ code: "invalid_request", field: "member_id" });
      if (!isNumber(b["amount"])) return apiFail({ code: "invalid_request", field: "amount" });
      if (!isString(b["reason"])) return apiFail({ code: "invalid_request", field: "reason" });
      return apiOk({ ...base, type: "Deduct", memberId: b["member_id"] as MemberId, amount: b["amount"] as PosInt, reason: b["reason"] });
    }
    case "redemptions.approve":
    case "redemptions.reject":
    case "redemptions.fulfil": {
      const reason = b["reason"];
      if (reason !== undefined && reason !== null && !isString(reason)) return apiFail({ code: "invalid_request", field: "reason" });
      const transition = match.route.id.slice("redemptions.".length) as ApiRedemptionTransition;
      const cmd: ApiTransitionRedemption = { ...base, type: "TransitionRedemption", redemptionId: id, transition, reason: reason ?? null };
      return apiOk(cmd);
    }
    case "rewards.create": {
      const f = rewardFields(b, () => true);
      if (!f.ok) return f;
      if (!("title" in f.value)) return apiFail({ code: "invalid_request", field: "title" });
      if (!("cost" in f.value)) return apiFail({ code: "invalid_request", field: "cost" });
      const reward: RewardInput = {
        description: "",
        image: null,
        stock: null,
        variants: [],
        categories: [],
        internalCost: null,
        instructions: "",
        autoApprove: null,
        giftCard: false,
        ...(f.value as Pick<RewardInput, "title" | "cost">),
      };
      const cmd: ApiCreateReward = { ...base, type: "CreateReward", reward };
      return apiOk(cmd);
    }
    case "rewards.update": {
      const f = rewardFields(b, (field) => EDITABLE.has(field));
      if (!f.ok) return f;
      const cmd: ApiUpdateReward = { ...base, type: "UpdateReward", rewardId: id, changes: f.value as RewardChanges };
      return apiOk(cmd);
    }
    case "rewards.archive": {
      const cmd: ApiArchiveReward = { ...base, type: "SetRewardStatus", rewardId: id, status: "archived" };
      return apiOk(cmd);
    }
    default:
      return apiFail({ code: "route_not_found" });
  }
}
