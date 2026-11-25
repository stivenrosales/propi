// Synthetic ledger + gift headers for the insights/boards query tests. No real data.
import { defaultSettings } from "../../src/workspace/settings.ts";
import type { Gift } from "../../src/giving/types.ts";
import type { EntryKind, LedgerEntry } from "../../src/ledger/entries.ts";
import type { MemberRecord } from "../../src/members/members.ts";
import type { CommandKey, GiftId, Instant, LocalDate, MemberId, PosInt, Role, ValueId, WorkspaceId } from "../../src/shared/types.ts";
import type { Value } from "../../src/values/values.ts";
import type { WorkspaceSettings } from "../../src/workspace/settings.ts";
import { defaultInsightsSettings, type BoardData, type InsightsSettings } from "../../src/boards/index.ts";

export const TZ = "America/Lima";
export const m = (s: string) => s as MemberId;
export const v = (s: string) => s as ValueId;
export const g = (s: string) => s as GiftId;
export const d = (s: string) => s as LocalDate;
/** 10:00 local time in Lima (UTC-5) on the given date. */
export const lima = (date: string, hour = 10): Instant => {
  const [y, mo, day] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, mo - 1, day, hour + 5) as Instant;
};
/** Wednesday 2026-11-25, 10:00 in Lima. The ISO week starts Monday 2026-11-23. */
export const NOW = lima("2026-11-25");

export interface GiveSpec {
  readonly id: string;
  readonly from: string;
  readonly to: Readonly<Record<string, number>>;
  readonly on?: string;
  readonly channel?: string;
  readonly isPrivate?: boolean;
  readonly values?: readonly string[];
  readonly text?: string | null;
}

export function world() {
  let seq = 0;
  const entries: LedgerEntry[] = [];
  const gifts: Gift[] = [];
  const members: MemberRecord[] = [];
  let values: Value[] = [];

  const push = (kind: EntryKind, member: string, amount: number, over: Partial<LedgerEntry> = {}) => {
    seq++;
    entries.push({
      seq,
      workspaceId: "ws-1" as WorkspaceId,
      commandKey: `cmd:${seq}` as CommandKey,
      ordinal: 0,
      kind,
      amount: amount as PosInt,
      memberId: m(member),
      counterpartId: null,
      cause: { type: "admin" },
      source: null,
      allowanceDay: null,
      at: NOW,
      reason: null,
      ...over,
    });
  };

  const api = {
    member(id: string, role: Role = "member", active = true) {
      members.push({ id: m(id), role, active, dailyLimitOverride: null });
      return api;
    },
    values(list: readonly { id: string; name: string; hashtag?: string; emoji?: string }[]) {
      values = list.map((x) => ({ id: v(x.id), name: x.name, hashtag: x.hashtag ?? null, emoji: x.emoji ?? null }));
      return api;
    },
    give(s: GiveSpec) {
      const at = lima(s.on ?? "2026-11-25");
      const text = s.text === undefined ? `thanks ${s.id}` : s.text;
      gifts.push({
        id: g(s.id),
        giver: m(s.from),
        messageRef: `ref:${s.id}`,
        source: "message",
        emoji: null,
        channelId: s.channel ?? "C1",
        isPrivate: s.isPrivate ?? false,
        text,
        valueIds: (s.values ?? []).map(v),
        allowanceDay: d(s.on ?? "2026-11-25"),
        createdAt: at,
        closedBy: null,
      });
      for (const [to, units] of Object.entries(s.to)) {
        push("gift", to, units, { counterpartId: m(s.from), cause: { type: "gift", giftId: g(s.id) }, source: "message", allowanceDay: d(s.on ?? "2026-11-25"), at, reason: text });
      }
      return api;
    },
    reverse(giftId: string, from: string, to: string, units: number, on = "2026-11-25") {
      push("gift_reversal", to, units, { counterpartId: m(from), cause: { type: "gift", giftId: g(giftId) }, source: "message", at: lima(on) });
      return api;
    },
    entry(kind: EntryKind, member: string, amount: number, on = "2026-11-25") {
      push(kind, member, amount, { at: lima(on) });
      return api;
    },
    data(over: { insights?: Partial<InsightsSettings>; workspace?: Partial<WorkspaceSettings> } = {}): BoardData {
      return {
        entries: [...entries],
        gifts: [...gifts],
        members: [...members],
        values: [...values],
        workspace: defaultSettings({ timezone: TZ, ...over.workspace }),
        insights: defaultInsightsSettings(over.insights),
      };
    },
  };
  return api;
}
