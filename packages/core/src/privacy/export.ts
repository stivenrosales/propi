// S71: an admin exports everything (gifts, ledger, redemptions, members) as CSV, with no date cap.
import type { Gift } from "../giving/types.ts";
import type { Cause, LedgerEntry } from "../ledger/entries.ts";
import type { MemberRecord } from "../members/members.ts";
import type { Actor, Instant, MemberId } from "../shared/types.ts";

/** The redemption columns the export needs; the shop module's adapter maps its rows to this. */
export interface ExportRedemptionRow {
  readonly id: string;
  readonly memberId: MemberId;
  readonly rewardId: string;
  readonly cost: number;
  readonly state: string;
  readonly createdAt: Instant;
}

export interface ExportSource {
  readonly entries: readonly LedgerEntry[];
  readonly gifts: readonly Gift[];
  readonly members: readonly MemberRecord[];
  readonly redemptions: readonly ExportRedemptionRow[];
}

export type CsvRow = readonly string[];

/** Each table is a header row followed by data rows. */
export interface ExportTables {
  readonly gifts: readonly CsvRow[];
  readonly ledger: readonly CsvRow[];
  readonly redemptions: readonly CsvRow[];
  readonly members: readonly CsvRow[];
}

const iso = (at: Instant): string => new Date(at).toISOString();
const opt = (s: string | null | undefined): string => s ?? "";

function causeId(c: Cause): string {
  switch (c.type) {
    case "gift":
      return c.giftId;
    case "redemption":
      return c.redemptionId;
    case "contribution":
      return c.collabId;
    case "rule":
      return `${c.ruleId}:${c.period}`;
    case "quest":
      return c.submissionId;
    case "milestone":
      return `${c.milestone}:${c.year}`;
    case "import":
      return c.source;
    case "admin":
      return "";
  }
}

export function exportAll(src: ExportSource): ExportTables {
  return {
    gifts: [
      ["gift_id", "giver_id", "source", "channel_id", "private", "text", "value_ids", "allowance_day", "created_at", "message_ref"],
      ...[...src.gifts]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((g) => [g.id, g.giver, g.source, g.channelId, String(g.isPrivate), opt(g.text), g.valueIds.join(" "), opt(g.allowanceDay), iso(g.createdAt), opt(g.messageRef)]),
    ],
    ledger: [
      ["seq", "command_key", "ordinal", "kind", "amount", "member_id", "counterpart_id", "cause_type", "cause_id", "source", "allowance_day", "at", "reason"],
      ...[...src.entries]
        .sort((a, b) => a.seq - b.seq)
        .map((e) => [
          String(e.seq),
          e.commandKey,
          String(e.ordinal),
          e.kind,
          String(e.amount),
          e.memberId,
          opt(e.counterpartId),
          e.cause.type,
          causeId(e.cause),
          opt(e.source),
          opt(e.allowanceDay),
          iso(e.at),
          opt(e.reason),
        ]),
    ],
    redemptions: [
      ["redemption_id", "member_id", "reward_id", "cost", "state", "created_at"],
      ...[...src.redemptions].sort((a, b) => a.createdAt - b.createdAt).map((r) => [r.id, r.memberId, r.rewardId, String(r.cost), r.state, iso(r.createdAt)]),
    ],
    members: [
      ["member_id", "role", "active", "daily_limit_override"],
      ...[...src.members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) => [r.id, r.role, String(r.active), r.dailyLimitOverride === null ? "" : String(r.dailyLimitOverride)]),
    ],
  };
}

/** RFC 4180: quote fields with commas, quotes, CR or LF; double inner quotes; "\n" line ends. */
export function toCsv(rows: readonly CsvRow[]): string {
  const field = (f: string) => (/[",\r\n]/.test(f) ? `"${f.replaceAll('"', '""')}"` : f);
  return rows.map((r) => r.map(field).join(",")).join("\n") + "\n";
}

/** S71: admins (and system jobs such as the CLI export) may export. */
export function canExport(actor: Actor | null): boolean {
  return actor !== null && ((actor.kind === "member" && actor.role === "admin") || actor.kind === "system");
}
