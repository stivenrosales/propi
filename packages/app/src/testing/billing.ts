// In-memory billing store (S6) for use-case tests. Same contract as the Postgres adapter.
import type { BillingAccount, BillingStore, SubscriptionRecord, WorkspaceId } from "@propi/core";

export function createMemoryBillingStore(): BillingStore & { put(s: SubscriptionRecord): void } {
  const subs = new Map<WorkspaceId, SubscriptionRecord>();
  const comped = new Set<WorkspaceId>();
  const events = new Set<string>();
  return {
    async account(ws): Promise<BillingAccount> {
      await Promise.resolve();
      return { subscription: subs.get(ws) ?? null, comped: comped.has(ws) };
    },
    async applySubscriptionEvent(e) {
      await Promise.resolve();
      if (events.has(e.eventId)) return "duplicate";
      events.add(e.eventId);
      const prev = subs.get(e.subscription.workspaceId);
      if (prev !== undefined && prev.sourceUpdatedAt > e.subscription.sourceUpdatedAt) return "stale";
      subs.set(e.subscription.workspaceId, e.subscription);
      return "applied";
    },
    async setComped(ws, on) {
      await Promise.resolve();
      if (on) comped.add(ws);
      else comped.delete(ws);
    },
    put: (s) => void subs.set(s.workspaceId, s),
  };
}
