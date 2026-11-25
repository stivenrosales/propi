// Decision shape shared by the engagement modules (rules, quests, stickers, levels, milestones, pairing).
// It is `Decision<T>` with the module's own error, event and write unions. Integration adds
// EngagementError to DomainError, the *Event unions to DomainEvent and the *Write unions to StateWrite
// (shared/decision.ts, shared/types.ts); until then the app widens these decisions in one place.
import type { NewEntry } from "../ledger/entries.ts";
import type { Instant, MemberId, Role } from "../shared/types.ts";

export type EngagementError =
  | { readonly code: "forbidden"; readonly need: Role }
  | { readonly code: "not_found"; readonly what: "rule" | "quest" | "submission" | "sticker" | "avatar" | "member" | "value" }
  | { readonly code: "invalid_field"; readonly field: string }
  | { readonly code: "invalid_transition"; readonly from: string; readonly to: string }
  | { readonly code: "inactive_member" }
  | { readonly code: "not_a_gift" }
  // rules (S61, S62)
  | { readonly code: "rule_inactive" }
  | { readonly code: "period_not_closed"; readonly closesAt: Instant }
  | { readonly code: "already_evaluated" }
  // quests (S64-S66)
  | { readonly code: "quest_not_open" }
  | { readonly code: "outside_window" }
  | { readonly code: "submitter_not_allowed"; readonly allowed: "self" | "nomination" | "both" }
  | { readonly code: "proof_required" }
  | { readonly code: "submission_pending" }
  | { readonly code: "cap_reached"; readonly cap: "member" | "team" }
  | { readonly code: "cooldown"; readonly until: Instant }
  | { readonly code: "amount_required" }
  | { readonly code: "timeline_disabled" }
  // stickers (S73-S76)
  | { readonly code: "module_disabled" }
  | { readonly code: "channel_not_allowed" } // S16
  | { readonly code: "quota_exhausted"; readonly used: number; readonly available: number }
  | { readonly code: "too_many_receivers"; readonly max: number }
  // levels (S79)
  | { readonly code: "avatar_locked"; readonly minLevel: number; readonly level: number }
  // milestones (S93)
  | { readonly code: "not_a_milestone"; readonly memberId: MemberId }
  | { readonly code: "not_due"; readonly dueAt: Instant }
  // pairing (S95)
  | { readonly code: "round_not_current"; readonly current: string };

export type ModuleOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: EngagementError };

export interface ModuleDecision<T, Ev, W> {
  readonly outcome: ModuleOutcome<T>;
  readonly entries: readonly NewEntry[];
  readonly writes: readonly W[];
  readonly events: readonly Ev[];
}

export function ok<T, Ev = never, W = never>(
  value: T,
  parts: { readonly entries?: readonly NewEntry[]; readonly writes?: readonly W[]; readonly events?: readonly Ev[] } = {},
): ModuleDecision<T, Ev, W> {
  return { outcome: { ok: true, value }, entries: parts.entries ?? [], writes: parts.writes ?? [], events: parts.events ?? [] };
}

/** A refusal moves nothing and emits nothing. */
export function fail(error: EngagementError): ModuleDecision<never, never, never> {
  return { outcome: { ok: false, error }, entries: [], writes: [], events: [] };
}

/** Admins (and system jobs) configure engagement modules. */
export function isAdminOrSystem(actor: { readonly kind: string; readonly role?: Role }): boolean {
  return actor.kind === "system" || (actor.kind === "member" && actor.role === "admin");
}
