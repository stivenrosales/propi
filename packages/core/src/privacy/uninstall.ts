// S72: uninstalling never deletes data. Deletion is a separate, explicit admin command; the
// owner-role adapter performs it (architecture §1.8) only after this decider authorizes it.
import { accept, reject, type Decision } from "../shared/decision.ts";
import type { Actor, CommandBase, Instant, WorkspaceId } from "../shared/types.ts";

export interface Uninstall extends CommandBase {
  readonly type: "Uninstall";
}

export interface DeleteWorkspaceData extends CommandBase {
  readonly type: "DeleteWorkspaceData";
  /** Must equal deletionConfirmation(workspaceId). */
  readonly confirmation: string;
}

export type PrivacyCommand = Uninstall | DeleteWorkspaceData;

export interface UninstallReceipt {
  readonly dataRetained: true;
}

export type DeletionReceipt =
  | { readonly status: "confirmation_required"; readonly expected: string }
  | { readonly status: "deletion_authorized"; readonly workspaceId: WorkspaceId };

const isAdmin = (a: Actor) => (a.kind === "member" && a.role === "admin") || a.kind === "system";

export const deletionConfirmation = (ws: WorkspaceId): string => `delete ${ws}`;

/** S72: an uninstall (platform event or admin) records the fact and moves or removes nothing. */
export function decideUninstall(_s: null, cmd: Uninstall, _now: Instant): Decision<UninstallReceipt> {
  if (!isAdmin(cmd.actor)) return reject({ code: "forbidden", need: "admin" });
  return accept({ dataRetained: true });
}

/** S72: deletion only with the typed confirmation phrase, by an admin member (never a system job). */
export function decideDeleteWorkspaceData(_s: null, cmd: DeleteWorkspaceData, _now: Instant): Decision<DeletionReceipt> {
  if (cmd.actor.kind !== "member" || cmd.actor.role !== "admin") return reject({ code: "forbidden", need: "admin" });
  const expected = deletionConfirmation(cmd.workspaceId);
  if (cmd.confirmation !== expected) return accept({ status: "confirmation_required", expected });
  return accept({ status: "deletion_authorized", workspaceId: cmd.workspaceId });
}
