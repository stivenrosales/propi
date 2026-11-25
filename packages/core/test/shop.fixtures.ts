// Synthetic shop fixtures for pure decider tests. No real data.
import type { Actor, Instant, MemberId, PosInt } from "../src/index.ts";
import { DEFAULT_SHOP_SETTINGS, type Redemption, type Reward, type RewardInput, type ShopSettings } from "../src/shop/index.ts";
import { NOON_LIMA, WS, key, m, record } from "./fixtures.ts";

export const NOW = NOON_LIMA;
export const system: Actor = { kind: "system", job: "test" };
export const apiToken = (scopes: ("redemptions:write" | "rewards:write")[]): Actor => ({ kind: "apiToken", tokenId: "tok-1" as never, scopes });

export const rewardInput = (over: Partial<RewardInput> = {}): RewardInput => ({
  title: "Lunch voucher",
  description: "Lunch for two",
  image: "https://example.test/lunch.png",
  cost: 12,
  stock: null,
  variants: [],
  categories: ["food"],
  internalCost: { minor: 2500, currency: "PEN" },
  instructions: "Show this at the counter",
  autoApprove: null,
  giftCard: false,
  ...over,
});

export const reward = (over: Partial<Reward> = {}): Reward => ({
  id: "rw-1",
  title: "Lunch voucher",
  description: "Lunch for two",
  image: null,
  cost: 12 as PosInt,
  stock: null,
  variants: [],
  categories: [],
  internalCost: { minor: 2500, currency: "PEN" },
  instructions: "",
  status: "active",
  autoApprove: null,
  giftCard: false,
  createdAt: 0 as Instant,
  ...over,
});

export const shopSettings = (over: Partial<ShopSettings> = {}): ShopSettings => ({ ...DEFAULT_SHOP_SETTINGS, ...over });

export const redemption = (over: Partial<Redemption> = {}): Redemption => ({
  id: "rd-1",
  memberId: m("ana"),
  rewardId: "rw-1",
  variantId: null,
  collabId: null,
  cost: 12 as PosInt,
  internalCost: { minor: 2500, currency: "PEN" },
  budgetMonth: null,
  stockReserved: false,
  giftCard: false,
  cardIssued: false,
  onBehalfOf: "self",
  state: "pending",
  createdAt: 0 as Instant,
  updatedAt: 0 as Instant,
  reason: null,
  ...over,
});

export const base = (k: string, actor: Actor) => ({ key: key(k), workspaceId: WS, actor, at: NOW });
export const ana = record("ana");
export const contributions = (pairs: [string, number][]): ReadonlyMap<MemberId, number> => new Map(pairs.map(([id, n]) => [m(id), n]));
