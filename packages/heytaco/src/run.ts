// Runs an import plan: create the planned members, then execute every command through the app.
import type { App, MemberRecord, WorkspaceId } from "@propi/app";
import type { ImportPlan, ImportedRedemptionState } from "@propi/core";

/** A member record plus the identities it was matched on (S102, S107). */
export interface ImportedMember extends MemberRecord {
  readonly slackUserId: string | null;
  readonly email: string | null;
}

/** Creates members. The Directory port is read-only, so the caller provides this (in-memory now, Postgres later). */
export interface MemberRegistrar {
  register(ws: WorkspaceId, member: ImportedMember): Promise<void>;
}

export interface ImportRun {
  readonly membersCreated: number;
  /** Commands that wrote entries now. */
  readonly applied: number;
  /** Commands whose key was already done (S105). */
  readonly replayed: number;
  /** Rejections by error code (e.g. invalid_amount, idempotency_key_reused). */
  readonly rejected: Readonly<Record<string, number>>;
  readonly redemptionStates: Readonly<Record<ImportedRedemptionState, number>>;
}

export async function importHeyTaco(args: { app: App; registrar: MemberRegistrar; workspaceId: WorkspaceId; plan: ImportPlan }): Promise<ImportRun> {
  const { app, registrar, workspaceId, plan } = args;
  let membersCreated = 0;
  for (const m of plan.members) {
    if (!m.isNew) continue;
    await registrar.register(workspaceId, { id: m.id, role: "member", active: m.active, dailyLimitOverride: m.dailyLimitOverride, slackUserId: m.slackUserId, email: m.email });
    membersCreated++;
  }
  let applied = 0;
  let replayed = 0;
  const rejected: Record<string, number> = {};
  const redemptionStates: Record<ImportedRedemptionState, number> = { fulfilled: 0, approved: 0 };
  for (const cmd of plan.commands) {
    const r = await app.executeAny(cmd);
    if (!r.ok) {
      rejected[r.error.code] = (rejected[r.error.code] ?? 0) + 1;
      continue;
    }
    if (r.replayed) replayed++;
    else applied++;
    if (cmd.type === "ImportHeyTacoRedemption") redemptionStates[(r.value as { state: ImportedRedemptionState }).state]++;
  }
  return { membersCreated, applied, replayed, rejected, redemptionStates };
}
