// S44-S47: catalog configuration as pure deciders.
import { isEntryAmount, isPosInt, type Instant, type PosInt } from "../shared/types.ts";
import { canManageShop, isMoney, shopAccept, shopReject } from "./rules.ts";
import type {
  ConfigureShop,
  CreateReward,
  Restock,
  Reward,
  RewardId,
  RewardStatus,
  RewardVariant,
  SetRewardStatus,
  ShopDecision,
  UpdateReward,
  ShopResults,
  ShopSettings,
  VariantId,
} from "./types.ts";

const forbidden = { code: "forbidden", need: "rewards:write" } as const;
const isStock = (n: number | null): boolean => n === null || (Number.isSafeInteger(n) && n >= 0);

/** S47, S52: workspace shop settings (budget in integer minor units, global auto-approval). */
export function decideConfigureShop(_s: null, cmd: ConfigureShop, _now: Instant): ShopDecision<ShopSettings> {
  if (!canManageShop(cmd.actor)) return shopReject(forbidden);
  const b = cmd.settings.monthlyBudget;
  if (b !== null && !isMoney(b)) return shopReject({ code: "invalid_reward", field: "monthlyBudget" });
  return shopAccept(cmd.settings, { writes: [{ t: "shop.settings.put", settings: cmd.settings }] });
}

export interface CreateRewardSnapshot {
  readonly rewardId: RewardId;
  readonly settings: ShopSettings;
}

/** S44: the first invalid field of a reward, or null. */
export function invalidRewardField(r: CreateReward["reward"], settings: ShopSettings): string | null {
  if (r.title.trim() === "") return "title";
  if (!isEntryAmount(r.cost)) return "cost"; // a cost becomes one ledger entry: at most MAX_ENTRY_AMOUNT
  if (!isStock(r.stock)) return "stock";
  const ids = new Set<VariantId>();
  for (const v of r.variants) {
    if (v.id === "" || ids.has(v.id) || v.name.trim() === "" || !isStock(v.stock)) return "variants";
    ids.add(v.id);
  }
  if (r.categories.some((c) => c.trim() === "")) return "categories";
  if (r.internalCost !== null && !isMoney(r.internalCost)) return "internalCost";
  if (r.internalCost !== null && settings.monthlyBudget !== null && r.internalCost.currency !== settings.monthlyBudget.currency) return "internalCost";
  if (r.giftCard && (r.internalCost === null || r.internalCost.minor === 0)) return "internalCost"; // S108: the card value
  return null;
}

/** S44, S45: a new reward starts as a draft. */
export function decideCreateReward(s: CreateRewardSnapshot, cmd: CreateReward, now: Instant): ShopDecision<ShopResults["CreateReward"]> {
  if (!canManageShop(cmd.actor)) return shopReject(forbidden);
  const field = invalidRewardField(cmd.reward, s.settings);
  if (field !== null) return shopReject({ code: "invalid_reward", field });
  const r = cmd.reward;
  const reward: Reward = {
    id: s.rewardId,
    title: r.title.trim(),
    description: r.description,
    image: r.image,
    cost: r.cost as PosInt,
    stock: r.variants.length > 0 ? null : r.stock,
    variants: r.variants.map((v): RewardVariant => ({ ...v })),
    categories: [...r.categories],
    internalCost: r.internalCost,
    instructions: r.instructions,
    status: "draft",
    autoApprove: r.autoApprove,
    giftCard: r.giftCard,
    createdAt: now,
  };
  return shopAccept({ rewardId: reward.id }, { writes: [{ t: "shop.reward.insert", reward }] });
}

/**
 * S44, S97: edit a reward's fields. The merged reward must pass the same checks as a new one; stock,
 * variants, gift-card mode and status keep their own commands. Archived rewards are final (S45).
 * Held redemptions keep the cost they were made at.
 */
export function decideUpdateReward(s: CreateRewardSnapshot & { readonly reward: Reward | null }, cmd: UpdateReward, _now: Instant): ShopDecision<ShopResults["UpdateReward"]> {
  if (!canManageShop(cmd.actor)) return shopReject(forbidden);
  const prev = s.reward;
  if (prev === null) return shopReject({ code: "reward_not_found" });
  if (prev.status === "archived") return shopReject({ code: "reward_not_active" });
  const c = cmd.changes;
  const merged: CreateReward["reward"] = {
    title: c.title ?? prev.title,
    description: c.description ?? prev.description,
    image: c.image === undefined ? prev.image : c.image,
    cost: c.cost ?? prev.cost,
    stock: prev.stock,
    variants: prev.variants,
    categories: c.categories ?? prev.categories,
    internalCost: c.internalCost === undefined ? prev.internalCost : c.internalCost,
    instructions: c.instructions ?? prev.instructions,
    autoApprove: c.autoApprove === undefined ? prev.autoApprove : c.autoApprove,
    giftCard: prev.giftCard,
  };
  const field = invalidRewardField(merged, s.settings);
  if (field !== null) return shopReject({ code: "invalid_reward", field });
  const reward: Reward = {
    ...prev,
    ...merged,
    title: merged.title.trim(),
    cost: merged.cost as PosInt,
    stock: prev.stock,
    variants: prev.variants,
    categories: [...merged.categories],
  };
  return shopAccept({ rewardId: prev.id }, { writes: [{ t: "shop.reward.update", from: prev.status, reward }] });
}

/** S45: draft -> active -> archived (a draft may also be archived). Archived is final. */
const REWARD_EDGES: Readonly<Record<RewardStatus, readonly RewardStatus[]>> = {
  draft: ["active", "archived"],
  active: ["archived"],
  archived: [],
};

export function decideSetRewardStatus(s: { readonly reward: Reward | null }, cmd: SetRewardStatus, _now: Instant): ShopDecision<ShopResults["SetRewardStatus"]> {
  if (!canManageShop(cmd.actor)) return shopReject(forbidden);
  const reward = s.reward;
  if (reward === null) return shopReject({ code: "reward_not_found" });
  if (!REWARD_EDGES[reward.status].includes(cmd.status)) return shopReject({ code: "illegal_reward_transition", from: reward.status, to: cmd.status });
  return shopAccept({ rewardId: reward.id, status: cmd.status }, { writes: [{ t: "shop.reward.status", rewardId: reward.id, from: reward.status, to: cmd.status }] });
}

/** The stock slot a redemption or restock touches: the variant's, or the reward's. */
export function stockOf(reward: Reward, variantId: VariantId | null): { readonly ok: true; readonly stock: number | null } | { readonly ok: false } {
  if (reward.variants.length === 0) return variantId === null ? { ok: true, stock: reward.stock } : { ok: false };
  const v = reward.variants.find((x) => x.id === variantId);
  return v === undefined ? { ok: false } : { ok: true, stock: v.stock };
}

/** S46: restocking makes an out-of-stock reward redeemable again. Unlimited stock cannot be restocked. */
export function decideRestock(s: { readonly reward: Reward | null }, cmd: Restock, _now: Instant): ShopDecision<ShopResults["Restock"]> {
  if (!canManageShop(cmd.actor)) return shopReject(forbidden);
  if (!isPosInt(cmd.quantity)) return shopReject({ code: "invalid_amount" });
  const reward = s.reward;
  if (reward === null) return shopReject({ code: "reward_not_found" });
  if (reward.status === "archived") return shopReject({ code: "reward_not_active" });
  const slot = stockOf(reward, cmd.variantId);
  if (!slot.ok) return shopReject({ code: "invalid_variant" });
  if (slot.stock === null) return shopReject({ code: "invalid_reward", field: "stock" });
  return shopAccept(
    { rewardId: reward.id, variantId: cmd.variantId, stock: slot.stock + cmd.quantity },
    { writes: [{ t: "shop.stock.add", rewardId: reward.id, variantId: cmd.variantId, quantity: cmd.quantity }] },
  );
}
