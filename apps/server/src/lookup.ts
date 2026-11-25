// SlackLookup over the Web API, the identity store and the Directory. Resolves Slack users into
// members (S107) and provisions a member the first time a human Slack user appears, so every person
// in the workspace can give and receive. Bots are never members (S8). Rules stay in core.
import { createHash } from "node:crypto";
import type { Actor, ChannelKind, IdentityRef, MemberId, Mention, WorkspaceId } from "@propi/app";
import type { SlackLookup } from "@propi/slack";
import type { Runtime } from "./runtime.ts";
import type { SlackGateway } from "./gateway.ts";
import type { SlackApi, SlackUserInfo } from "./slack-api.ts";

const TTL_MS = 60_000;

/** A tiny TTL cache; Slack lookups repeat for every message in a burst. */
export function ttlCache<V>(ttlMs = TTL_MS, now: () => number = Date.now) {
  const m = new Map<string, { at: number; v: V }>();
  return {
    async get(key: string, load: () => Promise<V>): Promise<V> {
      const hit = m.get(key);
      if (hit !== undefined && now() - hit.at < ttlMs) return hit.v;
      const v = await load();
      m.set(key, { at: now(), v });
      return v;
    },
    delete: (key: string) => void m.delete(key),
    clear: () => m.clear(),
  };
}

/** A stable member id per Slack identity, so two concurrent first sightings create one member. */
export function provisionedMemberId(ws: WorkspaceId, team: string, user: string): MemberId {
  const h = createHash("sha256").update(`${ws}\nslack\n${team}\n${user}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}` as MemberId;
}

export interface ServerLookup extends SlackLookup {
  /** The Slack user linked to a member, for DMs and `<@U…>` mentions. */
  slackUserOf(ws: WorkspaceId, member: MemberId): Promise<string | null>;
  /** Drops cached workspace and identity data (after install/uninstall). */
  invalidate(): void;
  /**
   * S6: a Slack profile arrived (user_change, team_join). Updates the linked member only; unknown
   * users are provisioned on first sighting instead. Bots are ignored. Returns the member, if any.
   */
  profile(ws: WorkspaceId, team: string, info: SlackUserInfo): Promise<MemberId | null>;
}

const profileFields = (info: SlackUserInfo) => ({ displayName: info.displayName ?? null, avatarUrl: info.avatarUrl ?? null });

/**
 * S6 backfill: copies display name and avatar from users.list onto every member linked to a Slack
 * user of `team`. Unlinked users are not provisioned here; unchanged profiles are not rewritten.
 */
export async function syncProfiles(rt: Runtime, slack: SlackApi, ws: WorkspaceId, team: string): Promise<{ readonly updated: number }> {
  const linked = new Map((await rt.identityStore.list(ws)).filter((i) => i.platform === "slack" && i.tenantId === team).map((i) => [i.userId, i.memberId]));
  if (linked.size === 0) return { updated: 0 };
  const current = new Map((await rt.ports.directory.members(ws)).map((r) => [r.id, r]));
  let updated = 0;
  for (const info of await slack.usersList()) {
    const id = linked.get(info.id);
    if (id === undefined || info.isBot) continue;
    const next = profileFields(info);
    const was = current.get(id);
    if (was === undefined || ((was.displayName ?? null) === next.displayName && (was.avatarUrl ?? null) === next.avatarUrl)) continue;
    await rt.admin.setMemberProfile(ws, id, next);
    updated++;
  }
  return { updated };
}

/**
 * S3: every Slack read goes through the client of the team it is about, and every cache is keyed by
 * team, so one workspace never sees another's users, channels or messages.
 */
export function createSlackLookup(rt: Runtime, gateway: SlackGateway, log: (msg: string, data?: unknown) => void = () => undefined): ServerLookup {
  const workspaces = ttlCache<WorkspaceId | null>();
  const users = ttlCache<SlackUserInfo | null>(10 * TTL_MS);
  const channels = ttlCache<ChannelKind>(10 * TTL_MS);
  const groups = ttlCache<readonly string[]>(5 * TTL_MS);
  const reverse = ttlCache<ReadonlyMap<MemberId, string>>();
  const ref = (team: string, user: string): IdentityRef => ({ platform: "slack", tenantId: team, userId: user });
  const withClient = async <V>(team: string, none: V, f: (slack: SlackApi) => Promise<V>): Promise<V> => {
    const slack = await gateway.forTeam(team);
    return slack === null ? none : f(slack);
  };

  async function provision(ws: WorkspaceId, team: string, info: SlackUserInfo): Promise<MemberId | null> {
    const user = info.id;
    const memberId = provisionedMemberId(ws, team, user);
    if ((await rt.ports.directory.member(ws, memberId)) === null) {
      await rt.admin.addMember(ws, { id: memberId, role: "member", active: true, dailyLimitOverride: null, ...profileFields(info) });
    }
    try {
      const linked = await rt.identities.link({ actor: { kind: "system", job: "slack-provision" }, workspaceId: ws, identity: ref(team, user), memberId });
      if (linked.ok) {
        reverse.delete(ws);
        log("member provisioned", { workspaceId: ws });
        return memberId;
      }
      if (linked.error.code === "identity_taken") return linked.error.memberId;
      return null;
    } catch (err) {
      // A concurrent first sighting linked it first (unique identity): use theirs.
      const again = await rt.identities.resolve(ws, ref(team, user));
      if (again !== null) return again;
      throw err;
    }
  }

  async function human(ws: WorkspaceId, team: string, user: string): Promise<{ kind: "member"; id: MemberId } | { kind: "bot" } | null> {
    const linked = await rt.identities.resolve(ws, ref(team, user));
    if (linked !== null) return { kind: "member", id: linked };
    const info = await users.get(`${team}:${user}`, () => withClient(team, null, (slack) => slack.userInfo(user)));
    if (info === null) return null;
    if (info.isBot) return { kind: "bot" };
    if (info.deleted) return null;
    const id = await provision(ws, team, info);
    return id === null ? null : { kind: "member", id };
  }

  return {
    workspace: (team) =>
      workspaces.get(team, async () => {
        const inst = await rt.installations.find("slack", team);
        return inst === null || inst.uninstalledAt !== null ? null : inst.workspaceId;
      }),
    settings: (ws) => rt.ports.directory.settings(ws),
    values: (ws) => rt.ports.directory.values(ws),
    async actor(ws, team, user): Promise<Actor | null> {
      const who = await human(ws, team, user);
      if (who === null) return null;
      if (who.kind === "bot") return { kind: "bot", platformUserId: user };
      const record = await rt.ports.directory.member(ws, who.id);
      return record === null ? null : { kind: "member", memberId: record.id, role: record.role };
    },
    async mention(ws, team, user): Promise<Mention | null> {
      const who = await human(ws, team, user);
      if (who === null) return null;
      return who.kind === "bot" ? { kind: "bot" } : { kind: "member", memberId: who.id };
    },
    async groupMembers(ws, team, group) {
      const ids = await groups.get(`${team}:${group}`, () => withClient(team, [], (slack) => slack.usergroupUsers(group)));
      const out: MemberId[] = [];
      for (const user of ids) {
        const who = await human(ws, team, user);
        if (who?.kind === "member") out.push(who.id);
      }
      return out;
    },
    message: (team, channel, ts) => withClient(team, null, (slack) => slack.message(channel, ts)),
    channelKind: (team, channel) =>
      channels.get(`${team}:${channel}`, async () => {
        const c = await withClient(team, null, (slack) => slack.channelInfo(channel));
        // Unknown channels count as private, the stricter reading of S16.
        if (c === null) return "private";
        return c.isIm || c.isMpim ? "dm" : c.isPrivate ? "private" : "public";
      }),
    async channelMembers(ws, team, channel) {
      const linked = new Map((await rt.identityStore.list(ws)).filter((i) => i.platform === "slack" && i.tenantId === team).map((i) => [i.userId, i.memberId]));
      return (await withClient(team, [], (slack) => slack.channelMembers(channel))).flatMap((u) => {
        const id = linked.get(u);
        return id === undefined ? [] : [id];
      });
    },
    async slackUserOf(ws, member) {
      const map = await reverse.get(ws, async () => new Map((await rt.identityStore.list(ws)).filter((i) => i.platform === "slack").map((i) => [i.memberId, i.userId])));
      return map.get(member) ?? null;
    },
    invalidate() {
      workspaces.clear();
      reverse.clear();
    },
    async profile(ws, team, info) {
      if (info.isBot) return null;
      users.delete(`${team}:${info.id}`);
      const linked = await rt.identities.resolve(ws, ref(team, info.id));
      if (linked !== null) {
        await rt.admin.setMemberProfile(ws, linked, profileFields(info));
        return linked;
      }
      // Profile events never create members: people join Propi when they first give or receive,
      // so guests and inactive users don't fill the member list or the isolation alerts.
      return null;
    },
  };
}
