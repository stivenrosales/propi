// Port type for identities (G3). packages/db implements it with the `identity` table.
import type { WorkspaceId } from "../shared/types.ts";
import type { IdentityRef, PlatformIdentity } from "./identity.ts";

export interface IdentityStore {
  find(ws: WorkspaceId, ref: IdentityRef): Promise<PlatformIdentity | null>;
  list(ws: WorkspaceId): Promise<readonly PlatformIdentity[]>;
  /** Insert; the store keeps (workspace, platform, tenant, user) unique. */
  insert(identity: PlatformIdentity): Promise<void>;
}
