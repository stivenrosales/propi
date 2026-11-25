// Shared synthetic setup for app use-case tests. No real data.
import {
  defaultSettings,
  type Actor,
  type CommandKey,
  type InboundMessage,
  type Instant,
  type MemberId,
  type Mention,
  type WorkspaceId,
  type WorkspaceSettings,
} from "@propi/core";
import { createApp } from "../src/index.ts";
import { createMemoryPorts, type MemoryOptions } from "../src/testing/index.ts";

export const WS = "ws-1" as WorkspaceId;
export const m = (s: string) => s as MemberId;
export const key = (s: string) => s as CommandKey;
/** 10:00 in America/Lima on 2026-11-25. */
export const T0 = Date.UTC(2026, 10, 25, 15, 0, 0) as Instant;
export const NEXT_DAY = Date.UTC(2026, 10, 26, 15, 0, 0) as Instant;

export const memberActor = (id: string, role: "admin" | "approver" | "member" = "member"): Actor => ({ kind: "member", memberId: m(id), role });
export const admin = memberActor("boss", "admin");

export function setup(opts: MemoryOptions & { settings?: Partial<WorkspaceSettings> } = {}) {
  const mem = createMemoryPorts({ now: T0, ...opts });
  mem.addWorkspace(WS, defaultSettings({ timezone: "America/Lima", ...opts.settings }));
  for (const id of ["giver", "ana", "diana", "lind", "bob"]) mem.addMember(WS, { id: m(id), role: "member", active: true, dailyLimitOverride: null });
  mem.addMember(WS, { id: m("boss"), role: "admin", active: true, dailyLimitOverride: null });
  mem.addMember(WS, { id: m("gone"), role: "member", active: false, dailyLimitOverride: null });
  const app = createApp(mem.ports);
  return { mem, app };
}

export const mention = (id: string): Mention => ({ kind: "member", memberId: m(id) });

export const msg = (text: string, mentions: Mention[], emojis: number | string[], over: Partial<InboundMessage> = {}): InboundMessage => ({
  channel: { id: "C1", kind: "public" },
  text,
  mentions,
  emojiTokens: typeof emojis === "number" ? Array.from({ length: emojis }, () => ":taco:") : emojis,
  hashtags: [],
  ...over,
});

let n = 0;
export const giveCmd = (from: string, message: InboundMessage, ref = `T:C1:${++n}`) =>
  ({
    type: "GiveByMessage",
    key: key(`slack:msg:${ref}`),
    workspaceId: WS,
    actor: memberActor(from),
    at: T0,
    messageRef: ref,
    message,
  }) as const;

export const reactCmd = (from: string, ref: string, target: { author: string; mentions?: Mention[] }, emoji = ":taco:") =>
  ({
    type: "GiveByReaction",
    key: key(`slack:react:${ref}:${from}:${emoji}`),
    workspaceId: WS,
    actor: memberActor(from),
    at: T0,
    messageRef: ref,
    emoji,
    channel: { id: "C1", kind: "public" },
    target: { author: m(target.author), mentions: target.mentions ?? [] },
  }) as const;

export const unreactCmd = (from: string, ref: string, emoji = ":taco:") =>
  ({
    type: "RemoveReaction",
    key: key(`slack:unreact:${ref}:${from}:${emoji}`),
    workspaceId: WS,
    actor: memberActor(from),
    at: T0,
    messageRef: ref,
    emoji,
  }) as const;
