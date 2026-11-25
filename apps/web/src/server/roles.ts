// Role guards for the web UI (S5, S6). These only decide which pages and buttons a viewer sees; every
// write is still authorized again by core inside `execute`.
import type { Role } from "@propi/core";

export type Need = "member" | "approver" | "admin";

const RANK: Record<Role, number> = { member: 0, approver: 1, admin: 2 };
const NEED: Record<Need, number> = { member: 0, approver: 1, admin: 2 };

/** admin ⊇ approver ⊇ member. */
export function allows(role: Role, need: Need): boolean {
  return RANK[role] >= NEED[need];
}

/** S5: only admins change roles, and never their own. */
export function canChangeRoleOf(viewer: { readonly memberId: string; readonly role: Role }, target: string): boolean {
  return viewer.role === "admin" && viewer.memberId !== target;
}

export interface AccessDecision {
  readonly ok: boolean;
  /** Where to send a viewer who may not see the page. */
  readonly redirect: string | null;
}

/** A page guard: no session → sign in; insufficient role → the member home; inactive → sign in (S7). */
export function decideAccess(viewer: { readonly role: Role; readonly active: boolean } | null, need: Need): AccessDecision {
  if (viewer === null || !viewer.active) return { ok: false, redirect: "/signin" };
  if (!allows(viewer.role, need)) return { ok: false, redirect: "/app?denied=1" };
  return { ok: true, redirect: null };
}
