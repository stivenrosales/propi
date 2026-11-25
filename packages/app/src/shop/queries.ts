// Shop read models. Read-only; they never lock.
import type { Actor, MemberId } from "@propi/core";
import { raisedOf, type CollabId, type CollabPhase, type Reward, type ShopReader } from "./core.ts";
import { canManageShop } from "./core.ts";

/**
 * S44, S45: the catalog as a viewer sees it. Members see active rewards only and never the
 * internal monetary cost; admins see every reward with it.
 */
export async function rewardCatalog(reader: ShopReader, viewer: Actor): Promise<readonly Reward[]> {
  const all = await reader.rewards();
  if (canManageShop(viewer)) return all;
  return all.filter((r) => r.status === "active").map((r) => ({ ...r, internalCost: null }));
}

export interface CollabProgress {
  readonly collabId: CollabId;
  readonly title: string;
  readonly goal: number;
  readonly raised: number;
  readonly phase: CollabPhase;
  readonly contributors: readonly { readonly memberId: MemberId; readonly amount: number }[];
}

/** S56: progress is visible to all. */
export async function collabProgress(reader: ShopReader, id: CollabId): Promise<CollabProgress | null> {
  const c = await reader.collab(id);
  if (c === null) return null;
  const contributions = await reader.contributions(id);
  const contributors = [...contributions]
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([memberId, amount]) => ({ memberId, amount }));
  return { collabId: c.id, title: c.title, goal: c.goal, raised: raisedOf(contributions), phase: c.phase, contributors };
}
