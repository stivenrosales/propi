// A fixture-backed SlackLookup: synthetic Slack ids mapped to members, no network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSettings, type ChannelKind, type MemberId, type PosInt, type Value, type ValueId, type WorkspaceId, type WorkspaceSettings } from "@propi/app";
import type { SlackLookup, SlackMessageRef } from "../src/index.ts";

export const TEAM = "T0PROPI001";
export const WS = "ws-slack" as WorkspaceId;
export const fixture = <T = never>(name: string): T => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")) as T;

/** Slack user → member id. */
export const USERS: Readonly<Record<string, string>> = {
  U0GIVER001: "giver",
  U0ANA00001: "ana",
  U0DIANA001: "diana",
  U0BOB00001: "bob",
  U0BOSS0001: "boss",
};
export const BOTS = new Set(["U0BOTUSER1"]);
export const VALUES: Value[] = [
  { id: "v-own" as ValueId, name: "Ownership", hashtag: "#ownership", emoji: ":muscle:" },
  { id: "v-fun" as ValueId, name: "Fun", hashtag: "#fun", emoji: null },
];
export const settings = (over: Partial<WorkspaceSettings> = {}): WorkspaceSettings =>
  defaultSettings({
    timezone: "America/Lima",
    currency: { primaryEmoji: ":taco:", singular: "taco", plural: "tacos", extraEmojis: new Map([[":fire:", 3 as PosInt]]) },
    ...over,
  });

export interface FakeLookupOptions {
  readonly settings?: WorkspaceSettings;
  readonly messages?: Readonly<Record<string, SlackMessageRef>>;
  readonly channels?: Readonly<Record<string, ChannelKind>>;
}

export function fakeLookup(opts: FakeLookupOptions = {}): SlackLookup & { calls: string[] } {
  const calls: string[] = [];
  const s = opts.settings ?? settings();
  return {
    calls,
    workspace: async (team) => (team === TEAM ? WS : null),
    settings: async () => s,
    values: async () => VALUES,
    async actor(_ws, _team, user) {
      calls.push(`actor:${user}`);
      if (BOTS.has(user)) return { kind: "bot", platformUserId: user };
      const id = USERS[user];
      return id === undefined ? null : { kind: "member", memberId: id as MemberId, role: id === "boss" ? "admin" : "member" };
    },
    async mention(_ws, _team, user) {
      if (BOTS.has(user)) return { kind: "bot" };
      const id = USERS[user];
      return id === undefined ? null : { kind: "member", memberId: id as MemberId };
    },
    async groupMembers(_ws, _team, group) {
      calls.push(`group:${group}`);
      return group === "S0DESIGN01" ? (["ana", "bob", "giver"] as MemberId[]) : [];
    },
    async message(_team, channel, ts) {
      calls.push(`message:${channel}:${ts}`);
      return opts.messages?.[`${channel}:${ts}`] ?? null;
    },
    channelKind: async (_team, channel) => opts.channels?.[channel] ?? (channel.startsWith("D") ? "dm" : "public"),
    channelMembers: async () => ["ana", "bob", "giver"] as MemberId[],
  };
}
