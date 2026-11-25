// Shop ports (G3): what the shop use cases read inside a unit of work, and the S108 provider.
import type { Instant, MemberId, WorkspaceId } from "../shared/types.ts";
import type { Collab, CollabId, Money, Redemption, RedemptionId, Reward, RewardId, ShopSettings } from "./types.ts";

/**
 * Shop reads. A Tx (inside the locks) and the read-only workspace reader (for naming locks)
 * both implement it when the shop store is wired.
 */
export interface ShopReader {
  shopSettings(): Promise<ShopSettings>;
  reward(id: RewardId): Promise<Reward | null>;
  rewards(): Promise<readonly Reward[]>;
  redemption(id: RedemptionId): Promise<Redemption | null>;
  redemptions(): Promise<readonly Redemption[]>;
  /** S47: internal cost of held redemptions counted against `month` ("YYYY-MM"). */
  budgetSpent(month: string): Promise<number>;
  /** S108: provider balance minus what held, not yet issued gift-card redemptions reserve; null without a provider. */
  prepaidAvailable(): Promise<Money | null>;
  collab(id: CollabId): Promise<Collab | null>;
  /** S56: net units each member has in the collab (spend - refund entries with cause contribution). */
  contributions(id: CollabId): Promise<ReadonlyMap<MemberId, number>>;
}

export function isShopReader(x: object): x is ShopReader {
  return typeof (x as Partial<ShopReader>).shopSettings === "function" && typeof (x as Partial<ShopReader>).contributions === "function";
}

/** S108: the external gift-card provider. Issuing is idempotent per key. */
export interface GiftCardProvider {
  prepaidBalance(ws: WorkspaceId): Promise<Money>;
  issue(req: { readonly key: string; readonly workspaceId: WorkspaceId; readonly redemptionId: RedemptionId; readonly memberId: MemberId; readonly value: Money; readonly at: Instant }): Promise<{ readonly ok: boolean }>;
}
