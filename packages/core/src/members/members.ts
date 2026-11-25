// S5-S8: roles, activation, bots.
import type { Actor, DomainError, MemberId, PosInt, Role } from "../shared/types.ts";
import type { WorkspaceSettings } from "../workspace/settings.ts";

export interface MemberRecord {
  readonly id: MemberId;
  readonly role: Role;
  readonly active: boolean; // S7
  readonly dailyLimitOverride: PosInt | null; // S25
}

/** S5: whoever installs the app becomes the first admin. */
export function installerMember(id: MemberId): MemberRecord {
  return { id, role: "admin", active: true, dailyLimitOverride: null };
}

/** S5: only admins change roles, and never their own. */
export function canChangeRole(actor: Actor, target: MemberId): boolean {
  return actor.kind === "member" && actor.role === "admin" && actor.memberId !== target;
}

/** S6: approvers (and admins) may approve redemptions and submissions. */
export function canApprove(actor: Actor): boolean {
  return actor.kind === "member" && (actor.role === "admin" || actor.role === "approver");
}

/** Admin adjustments (S36-S39): admins, API tokens with adjustments:write, and system jobs. */
export function canAdjust(actor: Actor): boolean {
  switch (actor.kind) {
    case "member":
      return actor.role === "admin";
    case "apiToken":
      return actor.scopes.includes("adjustments:write");
    case "system":
      return true;
    case "bot":
      return false;
  }
}

/** S7, S8: only active members receive. Bots are never members (null record). */
export function canReceive(record: MemberRecord | null): boolean {
  return record !== null && record.active;
}

/** The giver as the ledger sees it. Bots get a synthetic counterpart id `bot:<platformUserId>` (S8). */
export interface Giver extends MemberRecord {
  readonly isBot: boolean;
}

export type GiverResolution = { readonly ok: true; readonly giver: Giver } | { readonly ok: false; readonly error: DomainError };

/** S7, S8: who gives for this actor, or why they cannot. */
export function resolveGiver(actor: Actor, record: MemberRecord | null, settings: WorkspaceSettings): GiverResolution {
  if (actor.kind === "bot") {
    if (!settings.botsMayGive) return { ok: false, error: { code: "bots_may_not_give" } };
    return {
      ok: true,
      giver: { id: `bot:${actor.platformUserId}` as MemberId, isBot: true, role: "member", active: true, dailyLimitOverride: null },
    };
  }
  if (actor.kind !== "member") return { ok: false, error: { code: "forbidden", need: "member" } };
  if (record === null) return { ok: false, error: { code: "unknown_member", memberId: actor.memberId } };
  if (!record.active) return { ok: false, error: { code: "inactive_member" } };
  return { ok: true, giver: { ...record, isBot: false } };
}
