// Postgres read side for boards, notifications, insights and the export (S43, S69-S71, S80-S91).
//
// - `source` implements core's InsightsSource, so app's boardQueries / notifyQueries /
//   insightsQueries / privacyQueries run unchanged over Postgres (they fold over BoardData).
// - `leaderboard` and `valuesReport` answer S80-S82 and S43 in SQL, for workspaces whose history is
//   too large to fold in memory. They return exactly what the core folds return on the same data
//   (test/insights.test.ts compares them); sums are BIGINT in SQL and checked on the way out.
// - Settings and preferences are configuration, written directly (like the memory fake does).
import type { Instant, MemberId, Redemption, ValueId, WorkspaceId } from "@propi/core";
import {
  defaultInsightsSettings,
  rangeOf,
  type DateRange,
  type InsightsSettings,
  type InsightsSource,
  type LeaderboardQuery,
  type LeaderboardRow,
  type Timeframe,
  type ValueReportRow,
} from "@propi/core/boards";
import { setPreference, type NotificationPreferences, type NotificationType } from "@propi/core/notify";
import type { ExportRedemptionRow } from "@propi/core/privacy";
import { Prisma, type PrismaClient } from "./client.ts";
import { safeNumber } from "./numbers.ts";
import { readGifts } from "./ports.ts";
import { toJson } from "./settings-json.ts";

export interface DbInsights {
  readonly source: InsightsSource;
  /** Merges over the current settings (same as the memory fake's setSettings). */
  setSettings(ws: WorkspaceId, over: Partial<InsightsSettings>): Promise<void>;
  /** Replaces a member's preferences. */
  setPreferences(ws: WorkspaceId, member: MemberId, prefs: NotificationPreferences): Promise<void>;
  /** S85: turns one notification type on or off, keeping the others (core setPreference). */
  setPreference(ws: WorkspaceId, member: MemberId, type: NotificationType, on: boolean): Promise<NotificationPreferences>;
  /** S80-S82 in SQL: equals core `leaderboard(data, q, now)`. Authorization (S81) stays with the caller. */
  leaderboard(ws: WorkspaceId, q: LeaderboardQuery, now: Instant): Promise<LeaderboardRow[]>;
  /** S43 in SQL: equals core `valuesReport(data, rangeOf(timeframe, now, tz))`. */
  valuesReport(ws: WorkspaceId, timeframe: Timeframe, now: Instant): Promise<ValueReportRow[]>;
}

/** S71: a redemption as the export lists it. Group redemptions have no member (empty cell). */
export const exportRedemptionRow = (r: Redemption): ExportRedemptionRow => ({
  id: r.id,
  memberId: (r.memberId ?? "") as MemberId,
  rewardId: r.rewardId ?? "",
  cost: r.cost,
  quantity: r.quantity ?? 1,
  state: r.state,
  createdAt: r.createdAt,
});

/** The ledger kinds that are gift lines (core boards/facts.ts giftLines). */
const LINE_KINDS = Prisma.sql`('gift', 'gift_reversal')`;

/** BIGINT columns that are counts or sums. */
const n = (v: bigint | number): number => safeNumber(v);

export function createDbInsights(prisma: PrismaClient): DbInsights {
  async function settings(ws: WorkspaceId): Promise<InsightsSettings> {
    const [row] = await prisma.$queryRaw<{ data: InsightsSettings }[]>`
      SELECT data FROM module_config WHERE workspace_id = ${ws} AND module = 'insights'`;
    return row === undefined ? defaultInsightsSettings() : { ...defaultInsightsSettings(), ...row.data };
  }

  async function timezone(ws: WorkspaceId): Promise<string> {
    const [row] = await prisma.$queryRaw<{ tz: string | null }[]>`SELECT settings->>'timezone' AS tz FROM workspace WHERE id = ${ws}`;
    if (row === undefined) throw new Error(`unknown workspace ${ws}`);
    return row.tz ?? "UTC";
  }

  /** The local-date filter of core `inRange(localDate(at, tz), range)`. */
  const inRange = (tz: string, r: DateRange) => Prisma.sql`
    (${r.from}::date IS NULL OR (e.at AT TIME ZONE ${tz})::date >= ${r.from}::date)
    AND (${r.to}::date IS NULL OR (e.at AT TIME ZONE ${tz})::date <= ${r.to}::date)`;

  async function readPreferences(ws: WorkspaceId): Promise<Map<MemberId, NotificationPreferences>> {
    const rows = await prisma.$queryRaw<{ member_id: string; prefs: NotificationPreferences }[]>`
      SELECT member_id, prefs FROM notification_preference WHERE workspace_id = ${ws} ORDER BY seq`;
    return new Map(rows.map((r) => [r.member_id as MemberId, r.prefs]));
  }

  const source: InsightsSource = {
    gifts: (ws) => readGifts(prisma, ws),
    settings,
    preferences: readPreferences,
    async redemptions(ws) {
      const rows = await prisma.$queryRaw<{ data: Redemption; state: Redemption["state"] }[]>`
        SELECT data, state FROM redemption WHERE workspace_id = ${ws} ORDER BY seq`;
      return rows.map((r) => exportRedemptionRow({ ...r.data, state: r.state }));
    },
  };

  return {
    source,

    async setSettings(ws, over) {
      // First write stores defaults + over; later writes merge `over` into the stored document.
      await prisma.$executeRaw`
        INSERT INTO module_config (workspace_id, module, data)
        VALUES (${ws}, 'insights', ${toJson({ ...defaultInsightsSettings(), ...over })}::jsonb)
        ON CONFLICT (workspace_id, module) DO UPDATE SET data = module_config.data || ${toJson(over)}::jsonb`;
    },

    async setPreferences(ws, member, prefs) {
      await prisma.$executeRaw`
        INSERT INTO notification_preference (workspace_id, member_id, prefs) VALUES (${ws}, ${member}, ${toJson(prefs)}::jsonb)
        ON CONFLICT (workspace_id, member_id) DO UPDATE SET prefs = EXCLUDED.prefs`;
    },

    async setPreference(ws, member, type, on) {
      return prisma.$transaction(async (db) => {
        await db.$executeRaw`
          INSERT INTO notification_preference (workspace_id, member_id, prefs) VALUES (${ws}, ${member}, '{}'::jsonb)
          ON CONFLICT (workspace_id, member_id) DO NOTHING`;
        const [row] = await db.$queryRaw<{ prefs: NotificationPreferences }[]>`
          SELECT prefs FROM notification_preference WHERE workspace_id = ${ws} AND member_id = ${member} FOR UPDATE`;
        const next = setPreference(row?.prefs, type, on);
        await db.$executeRaw`
          UPDATE notification_preference SET prefs = ${toJson(next)}::jsonb WHERE workspace_id = ${ws} AND member_id = ${member}`;
        return next;
      });
    },

    async leaderboard(ws, q, now) {
      const [tz, s] = await Promise.all([timezone(ws), settings(ws)]);
      const range = rangeOf(q.timeframe, now, tz);
      const score = q.board === "received" ? Prisma.sql`received` : q.board === "given" ? Prisma.sql`given` : Prisma.sql`received + given`;
      const channel = q.channelId == null ? Prisma.sql`` : Prisma.sql`AND g.channel_id = ${q.channelId}`;
      const value =
        q.valueId == null
          ? Prisma.sql``
          : Prisma.sql`AND EXISTS (SELECT 1 FROM gift_value v WHERE v.workspace_id = g.workspace_id AND v.gift_id = g.id AND v.value_id = ${q.valueId})`;
      const rows = await prisma.$queryRaw<{ member_id: string; received: bigint; given: bigint; score: bigint; rank: bigint }[]>`
        WITH lines AS (
          SELECT e.member_id AS receiver, e.counterpart_id AS giver, e.amount::bigint AS units
          FROM ledger_entry e
          LEFT JOIN gift g ON e.cause_type = 'gift' AND g.workspace_id = e.workspace_id AND g.id = e.cause_id
          WHERE e.workspace_id = ${ws} AND e.kind IN ${LINE_KINDS} AND ${inRange(tz, range)} ${channel} ${value}
        ),
        rec AS (SELECT receiver AS id, SUM(units) AS total FROM lines GROUP BY receiver),
        giv AS (SELECT giver AS id, SUM(units) AS total FROM lines WHERE giver IS NOT NULL GROUP BY giver),
        scored AS (
          SELECT m.id AS member_id, COALESCE(rec.total, 0)::bigint AS received, COALESCE(giv.total, 0)::bigint AS given
          FROM member m LEFT JOIN rec ON rec.id = m.id LEFT JOIN giv ON giv.id = m.id
          WHERE m.workspace_id = ${ws} AND m.active AND NOT (m.id = ANY(${[...s.excludedFromBoards]}::text[]))
        ),
        ranked AS (SELECT member_id, received, given, (${score})::bigint AS score FROM scored)
        SELECT member_id, received, given, score, RANK() OVER (ORDER BY score DESC) AS rank
        FROM ranked WHERE score > 0
        ORDER BY score DESC, member_id COLLATE "C"
        LIMIT ${q.limit ?? null}`;
      return rows.map((r) => ({ rank: n(r.rank), memberId: r.member_id as MemberId, score: n(r.score), received: n(r.received), given: n(r.given) }));
    },

    async valuesReport(ws, timeframe, now) {
      const tz = await timezone(ws);
      const range = rangeOf(timeframe, now, tz);
      // Net per (receiver, gift) inside the range: a gift reversed in the period counts nothing.
      const rows = await prisma.$queryRaw<{ member_id: string; value_id: string; gifts: bigint; units: bigint }[]>`
        WITH net AS (
          SELECT e.member_id AS receiver, g.id AS gift_id, SUM(e.amount)::bigint AS units
          FROM ledger_entry e
          JOIN gift g ON e.cause_type = 'gift' AND g.workspace_id = e.workspace_id AND g.id = e.cause_id
          WHERE e.workspace_id = ${ws} AND e.kind IN ${LINE_KINDS} AND ${inRange(tz, range)}
          GROUP BY e.member_id, g.id
          HAVING SUM(e.amount) > 0
        )
        SELECT net.receiver AS member_id, v.value_id, COUNT(*)::bigint AS gifts, SUM(net.units)::bigint AS units
        FROM net JOIN gift_value v ON v.workspace_id = ${ws} AND v.gift_id = net.gift_id
        GROUP BY net.receiver, v.value_id
        ORDER BY net.receiver COLLATE "C", units DESC, v.value_id COLLATE "C"`;
      return rows.map((r) => ({ memberId: r.member_id as MemberId, valueId: r.value_id as ValueId, gifts: n(r.gifts), units: n(r.units) }));
    },
  };
}
