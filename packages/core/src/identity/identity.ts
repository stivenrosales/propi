// S107: a member links identities from several platforms; the ledger is keyed by MemberId, so every
// linked identity reads and spends the same balance. S106: adapters only resolve identities here,
// then build commands for the member; they hold no rules of their own.
import type { Actor, DomainError, MemberId, WorkspaceId } from "../shared/types.ts";
import type { MemberRecord } from "../members/members.ts";

export type Platform = "slack" | "teams";

export interface PlatformIdentity {
  readonly workspaceId: WorkspaceId;
  readonly platform: Platform;
  /** The platform's tenant: Slack team id, Teams tenant id. */
  readonly tenantId: string;
  /** The platform's user id. */
  readonly userId: string;
  readonly memberId: MemberId;
}

export type IdentityRef = Pick<PlatformIdentity, "platform" | "tenantId" | "userId">;

/** The unique key of an identity within a workspace. */
export const identityKey = (r: IdentityRef): string => `${r.platform}:${r.tenantId}:${r.userId}`;

export interface LinkIdentity {
  readonly actor: Actor;
  readonly workspaceId: WorkspaceId;
  readonly identity: IdentityRef;
  readonly memberId: MemberId;
}

export interface LinkIdentitySnapshot {
  /** The identity as currently linked, if at all. */
  readonly existing: PlatformIdentity | null;
  readonly member: MemberRecord | null;
}

export type IdentityError = DomainError | { readonly code: "identity_taken"; readonly memberId: MemberId };
export type IdentityOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: IdentityError };

/** Admins link by hand; the system links after a platform sign-in (OAuth) proved the person. */
const mayLink = (actor: Actor): boolean => (actor.kind === "member" && actor.role === "admin") || actor.kind === "system";

/**
 * S107: link an identity to a member. Linking the same identity to the same member again is a no-op;
 * an identity already linked to another member is refused (one identity, one member).
 */
export function decideLinkIdentity(s: LinkIdentitySnapshot, cmd: LinkIdentity): IdentityOutcome<{ readonly identity: PlatformIdentity; readonly changed: boolean }> {
  if (!mayLink(cmd.actor)) return { ok: false, error: { code: "forbidden", need: "admin" } };
  if (s.member === null) return { ok: false, error: { code: "unknown_member", memberId: cmd.memberId } };
  if (s.existing !== null) {
    if (s.existing.memberId === cmd.memberId) return { ok: true, value: { identity: s.existing, changed: false } };
    return { ok: false, error: { code: "identity_taken", memberId: s.existing.memberId } };
  }
  const identity: PlatformIdentity = { workspaceId: cmd.workspaceId, ...cmd.identity, memberId: cmd.memberId };
  return { ok: true, value: { identity, changed: true } };
}

/** S107: the member behind a platform identity, or null when it is not linked. */
export function resolveIdentity(identities: Iterable<PlatformIdentity>, ref: IdentityRef): MemberId | null {
  const k = identityKey(ref);
  for (const i of identities) if (identityKey(i) === k) return i.memberId;
  return null;
}

/** Every platform identity of one member. */
export function identitiesOf(identities: Iterable<PlatformIdentity>, member: MemberId): PlatformIdentity[] {
  return [...identities].filter((i) => i.memberId === member);
}
