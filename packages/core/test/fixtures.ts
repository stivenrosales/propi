// Synthetic fixtures for pure decider tests. No real data.
import {
  defaultSettings,
  type Actor,
  type CommandKey,
  type GiftId,
  type InboundMessage,
  type Instant,
  type MemberId,
  type MemberRecord,
  type Mention,
  type WorkspaceId,
  type WorkspaceSettings,
} from "../src/index.ts";

export const WS = "ws-1" as WorkspaceId;
export const m = (s: string) => s as MemberId;
export const gid = (s: string) => s as GiftId;
export const key = (s: string) => s as CommandKey;

/** 2026-11-25T15:00:00Z = 10:00 in America/Lima (UTC-5). */
export const NOON_LIMA = Date.UTC(2026, 10, 25, 15, 0, 0) as Instant;
export const at = (iso: string) => Date.parse(iso) as Instant;

export const settings = (over: Partial<WorkspaceSettings> = {}): WorkspaceSettings =>
  defaultSettings({ timezone: "America/Lima", ...over });

export const memberActor = (id: string, role: "admin" | "approver" | "member" = "member"): Actor => ({
  kind: "member",
  memberId: m(id),
  role,
});

export const record = (id: string, over: Partial<MemberRecord> = {}): MemberRecord => ({
  id: m(id),
  role: "member",
  active: true,
  dailyLimitOverride: null,
  ...over,
});

export const mention = (id: string): Mention => ({ kind: "member", memberId: m(id) });

export const message = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  channel: { id: "C1", kind: "public" },
  text: "",
  mentions: [],
  emojiTokens: [],
  hashtags: [],
  ...over,
});
