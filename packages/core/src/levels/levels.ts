// S77-S79: levels from a published threshold table, computed from the ledger; avatars unlock by level.
import type { Balances } from "../ledger/replay.ts";
import { fail, isAdminOrSystem, ok, type EngagementError, type ModuleDecision } from "../rules/module-decision.ts";
import type { CommandBase, Instant, MemberId, WorkspaceId } from "../shared/types.ts";

export interface Level {
  readonly level: number;
  readonly title: string;
  /** Points (received + given) needed to reach this level. */
  readonly min: number;
}

export interface Avatar {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
  readonly minLevel: number;
}

export interface LevelConfig {
  readonly table: readonly Level[];
  readonly avatars: readonly Avatar[];
}

/** S77: the published default table (HeyTaco keeps theirs secret). */
export const DEFAULT_LEVELS: readonly Level[] = [
  { level: 1, title: "Newcomer", min: 0 },
  { level: 2, title: "Contributor", min: 10 },
  { level: 3, title: "Connector", min: 50 },
  { level: 4, title: "Champion", min: 150 },
  { level: 5, title: "Catalyst", min: 400 },
  { level: 6, title: "Legend", min: 1000 },
];

export const DEFAULT_LEVEL_CONFIG: LevelConfig = { table: DEFAULT_LEVELS, avatars: [] };

export function validateLevelTable(table: readonly Level[]): EngagementError | null {
  if (table.length === 0) return { code: "invalid_field", field: "levels" };
  for (const [i, l] of table.entries()) {
    const prev = table[i - 1];
    if (i === 0 && l.min !== 0) return { code: "invalid_field", field: "levels[0].min" };
    if (!Number.isSafeInteger(l.min) || (prev !== undefined && l.min <= prev.min)) return { code: "invalid_field", field: `levels[${i}].min` };
    if (!Number.isSafeInteger(l.level) || (prev !== undefined && l.level <= prev.level)) return { code: "invalid_field", field: `levels[${i}].level` };
    if (l.title.trim() === "") return { code: "invalid_field", field: `levels[${i}].title` };
  }
  return null;
}

/** The highest level whose threshold `points` reaches. The table is assumed valid. */
export function levelFor(points: number, table: readonly Level[]): Level {
  let found = table[0]!;
  for (const l of table) if (points >= l.min) found = l;
  return found;
}

export interface MemberLevel {
  readonly level: number;
  readonly title: string;
  readonly points: number;
  readonly next: Level | null;
}

/** S77, S78: points = received + given, folded from the ledger; never stored. */
export function levelOf(balances: Balances, table: readonly Level[]): MemberLevel {
  const points = balances.received + balances.given;
  const current = levelFor(points, table);
  return { level: current.level, title: current.title, points, next: table.find((l) => l.min > points) ?? null };
}

/** S79 */
export const unlockedAvatars = (level: number, avatars: readonly Avatar[]): Avatar[] => avatars.filter((a) => a.minLevel <= level);

// ───────────── Commands ─────────────

export interface ConfigureLevels extends CommandBase {
  readonly type: "ConfigureLevels";
  readonly table: readonly Level[];
  readonly avatars: readonly Avatar[];
}
export interface ChooseAvatar extends CommandBase {
  readonly type: "ChooseAvatar";
  readonly avatarId: string;
}
export type LevelCommand = ConfigureLevels | ChooseAvatar;

export type LevelWrite =
  | { readonly t: "levels.config"; readonly config: LevelConfig }
  | { readonly t: "avatar.choose"; readonly memberId: MemberId; readonly avatarId: string };

export type LevelDecision<T> = ModuleDecision<T, never, LevelWrite>;

/** Read port for level configuration and avatar choices. */
export interface LevelStore {
  config(ws: WorkspaceId): Promise<LevelConfig>;
  avatar(ws: WorkspaceId, member: MemberId): Promise<string | null>;
}

/** S77, S79: an admin publishes the threshold table and avatar set. */
export function decideConfigureLevels(cmd: ConfigureLevels, _now: Instant): LevelDecision<LevelConfig> {
  if (!isAdminOrSystem(cmd.actor)) return fail({ code: "forbidden", need: "admin" });
  const bad = validateLevelTable(cmd.table);
  if (bad) return fail(bad);
  const config: LevelConfig = { table: cmd.table, avatars: cmd.avatars };
  return ok(config, { writes: [{ t: "levels.config", config }] });
}

export interface ChooseAvatarSnapshot extends LevelConfig {
  readonly balances: Balances;
}

/** S79: a member chooses an avatar their level has unlocked. */
export function decideChooseAvatar(s: ChooseAvatarSnapshot, cmd: ChooseAvatar, _now: Instant): LevelDecision<{ avatarId: string; level: number }> {
  if (cmd.actor.kind !== "member") return fail({ code: "forbidden", need: "member" });
  const avatar = s.avatars.find((a) => a.id === cmd.avatarId);
  if (avatar === undefined) return fail({ code: "not_found", what: "avatar" });
  const { level } = levelOf(s.balances, s.table);
  if (level < avatar.minLevel) return fail({ code: "avatar_locked", minLevel: avatar.minLevel, level });
  return ok({ avatarId: avatar.id, level }, { writes: [{ t: "avatar.choose", memberId: cmd.actor.memberId, avatarId: avatar.id }] });
}
