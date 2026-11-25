// S107: a Slack user signs in as the member their identity is linked to. The Slack team gives the
// workspace (through its installation); the team + user give the member (through identities).
// Nobody is created here: membership comes from the Slack install and the adapter, never from sign-in.
import type { Directory, IdentityRef, MemberId, WorkspaceId } from "@propi/core";

export interface SigninDeps {
  /** The workspace a Slack team installed Propi into, or null. */
  workspaceOf(teamId: string): Promise<WorkspaceId | null>;
  resolve(ws: WorkspaceId, ref: IdentityRef): Promise<MemberId | null>;
  readonly directory: Pick<Directory, "member">;
}

export type SigninResult =
  | { readonly ok: true; readonly workspaceId: WorkspaceId; readonly memberId: MemberId }
  | { readonly ok: false; readonly error: "workspace_not_installed" | "identity_not_linked" | "inactive_member" };

export async function memberForSlackUser(deps: SigninDeps, user: { readonly teamId: string; readonly userId: string }): Promise<SigninResult> {
  const ws = await deps.workspaceOf(user.teamId);
  if (ws === null) return { ok: false, error: "workspace_not_installed" };
  const memberId = await deps.resolve(ws, { platform: "slack", tenantId: user.teamId, userId: user.userId });
  if (memberId === null) return { ok: false, error: "identity_not_linked" };
  const record = await deps.directory.member(ws, memberId);
  if (record === null) return { ok: false, error: "identity_not_linked" };
  if (!record.active) return { ok: false, error: "inactive_member" }; // S7
  return { ok: true, workspaceId: ws, memberId };
}
