// Insights queries (S88-S91). Admin-only reads return `forbidden` for anyone else.
import { localDate, type Actor, type Outcome, type WorkspaceId } from "@propi/core";
import { isoWeekKey, rangeOf, type Timeframe } from "@propi/core/boards";
import {
  adminMetrics,
  canSeeInsights,
  digestInput,
  isolationAlertPlan,
  linkDigest,
  reciprocityFlags,
  type BudgetUse,
  type DigestInput,
  type DigestSummary,
  type IsolationAlertPlan,
  type ReciprocityFlag,
  type TeamMetrics,
} from "@propi/core/insights";
import { loadBoardData, type InsightsDeps } from "../boards/load.ts";

export interface MonthlyDigest {
  /** `job:digest:<ws>:<month>`. */
  readonly key: string;
  readonly input: DigestInput;
  /** Null when the digest is disabled (S70 text off). Quotes link only to gifts of the input. */
  readonly summary: DigestSummary | null;
}

export interface InsightsQueries {
  adminMetrics(ws: WorkspaceId, viewer: Actor | null, timeframe: Timeframe, budget?: BudgetUse | null): Promise<Outcome<TeamMetrics>>;
  isolationAlerts(ws: WorkspaceId): Promise<IsolationAlertPlan & { readonly key: string }>;
  reciprocity(ws: WorkspaceId, viewer: Actor | null, timeframe: Timeframe): Promise<Outcome<ReciprocityFlag[]>>;
  monthlyDigest(ws: WorkspaceId, month: string): Promise<MonthlyDigest>;
}

const FORBIDDEN = { ok: false, error: { code: "forbidden", need: "admin" } } as const;

export function insightsQueries(d: InsightsDeps): InsightsQueries {
  const now = () => d.ports.clock.now();
  return {
    async adminMetrics(ws, viewer, timeframe, budget = null) {
      if (!canSeeInsights(viewer)) return FORBIDDEN;
      const data = await loadBoardData(d, ws);
      return { ok: true, value: adminMetrics(data, rangeOf(timeframe, now(), data.workspace.timezone), budget) };
    },
    async isolationAlerts(ws) {
      const [data, preferences] = await Promise.all([loadBoardData(d, ws), d.source.preferences(ws)]);
      const plan = isolationAlertPlan(data, preferences, now());
      return { ...plan, key: `job:isolation:${ws}:${isoWeekKey(localDate(now(), data.workspace.timezone))}` };
    },
    async reciprocity(ws, viewer, timeframe) {
      if (!canSeeInsights(viewer)) return FORBIDDEN;
      const data = await loadBoardData(d, ws);
      return { ok: true, value: reciprocityFlags(data, rangeOf(timeframe, now(), data.workspace.timezone)) };
    },
    async monthlyDigest(ws, month) {
      const input = digestInput(await loadBoardData(d, ws), month);
      const key = `job:digest:${ws}:${month}`;
      if (!input.enabled) return { key, input, summary: null };
      if (d.summarizer === undefined) throw new Error("monthlyDigest needs a Summarizer port");
      return { key, input, summary: linkDigest(await d.summarizer.summarize(input), input) };
    },
  };
}
