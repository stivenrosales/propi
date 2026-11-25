// Read helpers shared by pages. Reads only: queries and folds come from @propi/app and @propi/core.
import { localDate, signedAmount, type Instant, type LedgerEntry, type MemberId, type MemberRecord, type WorkspaceId, type WorkspaceSettings } from "@propi/core";
import { collabProgress } from "@propi/app";
import { DEFAULT_LEVEL_CONFIG, levelOf, type LevelConfig } from "@propi/core/levels";
import { memberLabel } from "@/lib/format";
import { propi } from "./propi";

export interface WorkspaceView {
  readonly settings: WorkspaceSettings;
  readonly members: readonly MemberRecord[];
  /** Display label per member id. */
  label(id: string | null | undefined): string;
}

export async function workspaceView(ws: WorkspaceId): Promise<WorkspaceView> {
  const p = propi();
  const [settings, members] = await Promise.all([p.ports.directory.settings(ws), p.ports.directory.members(ws)]);
  return { settings, members, label: (id) => (id ? memberLabel(id) : "Someone") };
}

export async function levelsConfig(ws: WorkspaceId): Promise<LevelConfig> {
  return (await propi().engagement.levels.config(ws)) ?? DEFAULT_LEVEL_CONFIG;
}

export async function memberLevel(ws: WorkspaceId, member: MemberId) {
  const p = propi();
  const [balances, config] = await Promise.all([p.app.balances(ws, member), levelsConfig(ws)]);
  return { balances, config, level: levelOf(balances, config.table) };
}

/** A member's ledger lines, newest first (S30 history). */
export async function memberHistory(ws: WorkspaceId, member: MemberId, limit = 30): Promise<{ entry: LedgerEntry; delta: number }[]> {
  const entries = await propi().ports.reader.workspace(ws).entries();
  const mine: { entry: LedgerEntry; delta: number }[] = [];
  for (let i = entries.length - 1; i >= 0 && mine.length < limit; i--) {
    const e = entries[i]!;
    if (e.memberId === member) mine.push({ entry: e, delta: signedAmount(e) });
    else if (e.counterpartId === member && (e.kind === "gift" || e.kind === "gift_reversal")) mine.push({ entry: e, delta: 0 });
  }
  return mine;
}

export const ENTRY_LABEL: Record<LedgerEntry["kind"], string> = {
  gift: "Gift",
  gift_reversal: "Gift reversed",
  bonus: "Bonus",
  rule_award: "Award",
  quest_reward: "Quest reward",
  spend: "Spent",
  refund: "Refund",
  deduction: "Deduction",
};

/**
 * S56: every collaborative reward with its progress. The shop reader has no list of collabs yet, so
 * the ids come from one read of the collab table (reported as a needed `ShopReader.collabs()`).
 */
export async function collabs(ws: WorkspaceId) {
  const p = propi();
  const rows = await p.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM collab WHERE workspace_id = ${ws} ORDER BY seq DESC`;
  const reader = p.shop(ws);
  const out = [];
  for (const { id } of rows) {
    const [collab, progress] = await Promise.all([reader.collab(id), collabProgress(reader, id)]);
    if (collab !== null && progress !== null) out.push({ collab, progress });
  }
  return out;
}

/** Net gift units per local day for the last `days` days, oldest first (the insights chart). */
export async function dailyGiftUnits(ws: WorkspaceId, timezone: string, days = 30): Promise<{ day: string; units: number }[]> {
  const entries = await propi().ports.reader.workspace(ws).entries();
  const now = Date.now();
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(localDate((now - i * 86_400_000) as Instant, timezone));
  const sums = new Map(keys.map((k) => [k, 0]));
  for (const e of entries) {
    if (e.kind !== "gift" && e.kind !== "gift_reversal") continue;
    const k = localDate(e.at, timezone);
    if (sums.has(k)) sums.set(k, sums.get(k)! + signedAmount(e));
  }
  return keys.map((day) => ({ day, units: sums.get(day)! }));
}
