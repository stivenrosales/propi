// S6, S7: the Postgres billing store. Same contract as app/testing/billing.ts.
// Each provider event is recorded once in billing_event (primary key = provider + event id) in the
// same transaction as the subscription upsert, so a replayed webhook changes nothing. S12a: one live
// subscription per workspace; an event for another subscription id waits until the stored one ends.
import { isProSubscription, type ApplyBillingResult, type BillingStore, type Instant, type SubscriptionRecord, type WorkspaceId } from "@propi/core";
import type { PrismaClient } from "./client.ts";

interface SubRow {
  workspace_id: string;
  provider: string;
  subscription_id: string;
  customer_id: string | null;
  status: string;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  seats: number | null;
  source_updated_at: Date;
}

const toSub = (r: SubRow): SubscriptionRecord => ({
  workspaceId: r.workspace_id as WorkspaceId,
  provider: r.provider as "polar",
  subscriptionId: r.subscription_id,
  customerId: r.customer_id,
  status: r.status,
  currentPeriodEnd: r.current_period_end === null ? null : (r.current_period_end.getTime() as Instant),
  cancelAtPeriodEnd: r.cancel_at_period_end,
  seats: r.seats,
  sourceUpdatedAt: r.source_updated_at.getTime() as Instant,
});

export function createDbBilling(prisma: PrismaClient): BillingStore {
  return {
    async account(ws) {
      const rows = await prisma.$queryRaw<(SubRow & { comped: boolean; has_sub: boolean })[]>`
        SELECT w.comped, s.workspace_id IS NOT NULL AS has_sub, s.workspace_id, s.provider, s.subscription_id, s.customer_id, s.status,
               s.current_period_end, s.cancel_at_period_end, s.seats, s.source_updated_at
        FROM workspace w LEFT JOIN subscription s ON s.workspace_id = w.id
        WHERE w.id = ${ws}`;
      const r = rows[0];
      if (r === undefined) return { subscription: null, comped: false };
      return { subscription: r.has_sub ? toSub(r) : null, comped: r.comped };
    },

    async applySubscriptionEvent(e): Promise<ApplyBillingResult> {
      const s = e.subscription;
      return prisma.$transaction(async (tx) => {
        // The workspace row lock serializes events per workspace, also before its first subscription row.
        const known = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM workspace WHERE id = ${s.workspaceId} FOR UPDATE`;
        const ws = known.length === 0 ? null : s.workspaceId;
        const inserted = await tx.$executeRaw`
          INSERT INTO billing_event (provider, event_id, type, workspace_id, received_at)
          VALUES (${s.provider}, ${e.eventId}, ${e.type}, ${ws}, ${new Date(e.receivedAt)})
          ON CONFLICT (provider, event_id) DO NOTHING`;
        if (inserted === 0) return "duplicate";
        if (ws === null) return "unknown_workspace";
        // S12a: a live subscription is replaced only by events for its own id.
        const stored = await tx.$queryRaw<SubRow[]>`
          SELECT workspace_id, provider, subscription_id, customer_id, status, current_period_end, cancel_at_period_end, seats, source_updated_at
          FROM subscription WHERE workspace_id = ${s.workspaceId}`;
        const prev = stored[0] === undefined ? null : toSub(stored[0]);
        if (prev !== null && prev.subscriptionId !== s.subscriptionId && isProSubscription(prev, e.receivedAt)) return "foreign";
        const updated = await tx.$executeRaw`
          INSERT INTO subscription (workspace_id, provider, subscription_id, customer_id, status, current_period_end,
                                    cancel_at_period_end, seats, source_updated_at, updated_at)
          VALUES (${s.workspaceId}, ${s.provider}, ${s.subscriptionId}, ${s.customerId}, ${s.status},
                  ${s.currentPeriodEnd === null ? null : new Date(s.currentPeriodEnd)}, ${s.cancelAtPeriodEnd}, ${s.seats},
                  ${new Date(s.sourceUpdatedAt)}, now())
          ON CONFLICT (workspace_id) DO UPDATE SET
            provider = EXCLUDED.provider, subscription_id = EXCLUDED.subscription_id, customer_id = EXCLUDED.customer_id,
            status = EXCLUDED.status, current_period_end = EXCLUDED.current_period_end,
            cancel_at_period_end = EXCLUDED.cancel_at_period_end, seats = EXCLUDED.seats,
            source_updated_at = EXCLUDED.source_updated_at, updated_at = now()
          WHERE subscription.source_updated_at <= EXCLUDED.source_updated_at`;
        return updated === 0 ? "stale" : "applied";
      });
    },

    async recordSeats(ws, subscriptionId, seats) {
      await prisma.$executeRaw`UPDATE subscription SET seats = ${seats}, updated_at = now() WHERE workspace_id = ${ws} AND subscription_id = ${subscriptionId}`;
    },

    async setComped(ws, comped) {
      await prisma.$executeRaw`UPDATE workspace SET comped = ${comped} WHERE id = ${ws}`;
    },
  };
}
