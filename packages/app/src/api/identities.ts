// S107: link and resolve platform identities. Adapters (Slack, Teams) call `actorFor` to turn a
// platform user into the member actor they put on commands; the ledger never sees platform ids,
// so every linked identity shares one balance and one allowance.
import {
  decideLinkIdentity,
  type Actor,
  type Directory,
  type IdentityOutcome,
  type IdentityRef,
  type IdentityStore,
  type LinkIdentity,
  type MemberId,
  type PlatformIdentity,
  type WorkspaceId,
} from "@propi/core";

export interface IdentitiesDeps {
  readonly store: IdentityStore;
  readonly directory: Directory;
}

export interface Identities {
  link(cmd: LinkIdentity): Promise<IdentityOutcome<{ readonly identity: PlatformIdentity; readonly changed: boolean }>>;
  resolve(ws: WorkspaceId, ref: IdentityRef): Promise<MemberId | null>;
  /** The member actor for a platform user, or null when the identity is not linked. */
  actorFor(ws: WorkspaceId, ref: IdentityRef): Promise<Actor | null>;
}

export function createIdentities(deps: IdentitiesDeps): Identities {
  async function resolve(ws: WorkspaceId, ref: IdentityRef): Promise<MemberId | null> {
    return (await deps.store.find(ws, ref))?.memberId ?? null;
  }

  return {
    async link(cmd) {
      const existing = await deps.store.find(cmd.workspaceId, cmd.identity);
      const member = await deps.directory.member(cmd.workspaceId, cmd.memberId);
      const d = decideLinkIdentity({ existing, member }, cmd);
      if (d.ok && d.value.changed) await deps.store.insert(d.value.identity);
      return d;
    },
    resolve,
    async actorFor(ws, ref) {
      const id = await resolve(ws, ref);
      if (id === null) return null;
      const record = await deps.directory.member(ws, id);
      return record === null ? null : { kind: "member", memberId: record.id, role: record.role };
    },
  };
}
