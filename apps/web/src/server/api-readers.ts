// S97: the API reads owned by modules other than members and the ledger. Each one returns `data` or
// null (404). Response fields use snake_case like the members and ledger reads in @propi/app.
import { rewardCatalog, type ApiReadHandler } from "@propi/app";
import type { MemberId, ShopReader, ValueId, WorkspaceId, Gift } from "@propi/core";
import type { BoardKind, LeaderboardQuery, LeaderboardRow } from "@propi/core/boards";
import type { QuestStore } from "@propi/core/quests";
import { parseTimeframe } from "../lib/timeframe";

export interface ApiReaderDeps {
  gifts(ws: WorkspaceId): Promise<readonly Gift[]>;
  shop(ws: WorkspaceId): ShopReader;
  readonly quests: Pick<QuestStore, "quests">;
  leaderboard(ws: WorkspaceId, q: LeaderboardQuery): Promise<readonly LeaderboardRow[]>;
}

const snakeKey = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Deep camelCase → snake_case for plain JSON values; instants stay numbers named `*_at`. */
export function snake(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(snake);
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), snake(x)]));
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [snakeKey(k), snake(x)]));
  return v;
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** The public view of the catalog: active rewards, without the admin-only internal cost (S44). */
const PUBLIC_VIEWER = { kind: "member", memberId: "api" as MemberId, role: "member" } as const;

const BOARDS: readonly BoardKind[] = ["received", "given", "combined"];

export function apiReaders(d: ApiReaderDeps): Record<string, ApiReadHandler> {
  return {
    "gifts.list": async ({ workspaceId }) =>
      (await d.gifts(workspaceId)).map((g) => ({ ...(snake({ ...g, createdAt: undefined }) as object), created_at: iso(g.createdAt) })),
    "rewards.list": async ({ workspaceId }) => snake(await rewardCatalog(d.shop(workspaceId), PUBLIC_VIEWER)),
    "rewards.get": async ({ workspaceId, params }) => {
      const r = (await rewardCatalog(d.shop(workspaceId), PUBLIC_VIEWER)).find((x) => x.id === params["id"]);
      return r === undefined ? null : snake(r);
    },
    "redemptions.list": async ({ workspaceId }) => snake(await d.shop(workspaceId).redemptions()),
    "redemptions.get": async ({ workspaceId, params }) => {
      const r = await d.shop(workspaceId).redemption(params["id"] ?? "");
      return r === null ? null : snake(r);
    },
    "quests.list": async ({ workspaceId }) => snake((await d.quests.quests(workspaceId)).filter((q) => q.state !== "draft")),
    "leaderboards.get": async ({ workspaceId, params, query }) => {
      const board = params["board"] as BoardKind;
      if (!BOARDS.includes(board)) return null;
      const limit = Number(query["limit"] ?? "50");
      const rows = await d.leaderboard(workspaceId, {
        board,
        timeframe: parseTimeframe(query["timeframe"], query["from"], query["to"]),
        channelId: query["channel"] ?? null,
        valueId: (query["value"] ?? null) as ValueId | null,
        limit: Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 50,
      });
      return snake(rows);
    },
  };
}
