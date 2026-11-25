// In-memory identity store (S107) for use-case tests.
import { identityKey, type IdentityStore, type PlatformIdentity } from "@propi/core";

export function createMemoryIdentityStore(): IdentityStore & { all(): readonly PlatformIdentity[] } {
  const rows = new Map<string, PlatformIdentity>();
  const k = (ws: string, ref: Parameters<typeof identityKey>[0]) => `${ws}|${identityKey(ref)}`;
  return {
    async find(ws, ref) {
      await Promise.resolve();
      return rows.get(k(ws, ref)) ?? null;
    },
    async list(ws) {
      await Promise.resolve();
      return [...rows.values()].filter((r) => r.workspaceId === ws);
    },
    async insert(identity) {
      await Promise.resolve();
      const key = k(identity.workspaceId, identity);
      if (rows.has(key)) throw new Error(`identity ${key} already linked`);
      rows.set(key, identity);
    },
    all: () => [...rows.values()],
  };
}
