import { describe, expect, test } from "vitest";
import type { PosInt } from "../src/index.ts";
import { MAX_ENTRY_AMOUNT } from "../src/index.ts";
import { decideConfigureShop, decideCreateReward, decideRestock, decideSetRewardStatus, decideUpdateReward } from "../src/shop/index.ts";
import { memberActor } from "./fixtures.ts";
import { NOW, apiToken, base, reward, rewardInput, shopSettings } from "./shop.fixtures.ts";

const admin = memberActor("boss", "admin");
const create = (over: Parameters<typeof rewardInput>[0] = {}, actor = admin) => ({ type: "CreateReward", ...base("web:reward:1", actor), reward: rewardInput(over) }) as const;

describe("S44 reward fields", () => {
  test("S44: an admin creates a reward with every field, as a draft", () => {
    const d = decideCreateReward({ rewardId: "rw-9", settings: shopSettings() }, create({ variants: [{ id: "s", name: "Small", stock: 2 }, { id: "l", name: "Large", stock: null }] }), NOW);
    expect(d.outcome).toEqual({ ok: true, value: { rewardId: "rw-9" } });
    expect(d.writes).toEqual([
      {
        t: "shop.reward.insert",
        reward: {
          id: "rw-9",
          title: "Lunch voucher",
          description: "Lunch for two",
          image: "https://example.test/lunch.png",
          cost: 12,
          stock: null,
          variants: [{ id: "s", name: "Small", stock: 2 }, { id: "l", name: "Large", stock: null }],
          categories: ["food"],
          internalCost: { minor: 2500, currency: "PEN" },
          instructions: "Show this at the counter",
          status: "draft",
          autoApprove: null,
          giftCard: false,
          createdAt: NOW,
        },
      },
    ]);
    expect(d.entries).toEqual([]);
  });

  test("S44: invalid fields are refused, field by field", () => {
    const s = { rewardId: "rw-9", settings: shopSettings({ monthlyBudget: { minor: 10000, currency: "PEN" } }) };
    const field = (over: Parameters<typeof rewardInput>[0]) => decideCreateReward(s, create(over), NOW).outcome;
    expect(field({ title: "  " })).toEqual({ ok: false, error: { code: "invalid_reward", field: "title" } });
    expect(field({ cost: 0 })).toEqual({ ok: false, error: { code: "invalid_reward", field: "cost" } });
    expect(field({ cost: 1.5 })).toEqual({ ok: false, error: { code: "invalid_reward", field: "cost" } });
    expect(field({ stock: -1 })).toEqual({ ok: false, error: { code: "invalid_reward", field: "stock" } });
    expect(field({ variants: [{ id: "a", name: "A", stock: 1 }, { id: "a", name: "B", stock: 1 }] })).toEqual({ ok: false, error: { code: "invalid_reward", field: "variants" } });
    expect(field({ internalCost: { minor: 10.5, currency: "PEN" } })).toEqual({ ok: false, error: { code: "invalid_reward", field: "internalCost" } });
    expect(field({ internalCost: { minor: 100, currency: "USD" } })).toEqual({ ok: false, error: { code: "invalid_reward", field: "internalCost" } });
    expect(field({ giftCard: true, internalCost: null })).toEqual({ ok: false, error: { code: "invalid_reward", field: "internalCost" } });
  });

  test("S44: only admins or rewards:write tokens manage the catalog", () => {
    const s = { rewardId: "rw-9", settings: shopSettings() };
    expect(decideCreateReward(s, create({}, memberActor("ana")), NOW).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "rewards:write" } });
    expect(decideCreateReward(s, create({}, apiToken(["rewards:write"])), NOW).outcome.ok).toBe(true);
  });
});

describe("S45 reward lifecycle", () => {
  const status = (from: "draft" | "active" | "archived", to: "active" | "archived") =>
    decideSetRewardStatus({ reward: reward({ status: from }) }, { type: "SetRewardStatus", ...base("web:status", admin), rewardId: "rw-1", status: to }, NOW).outcome;

  test("S45: draft -> active -> archived; archived is final", () => {
    expect(status("draft", "active")).toEqual({ ok: true, value: { rewardId: "rw-1", status: "active" } });
    expect(status("active", "archived")).toEqual({ ok: true, value: { rewardId: "rw-1", status: "archived" } });
    expect(status("draft", "archived")).toEqual({ ok: true, value: { rewardId: "rw-1", status: "archived" } });
    expect(status("archived", "active")).toEqual({ ok: false, error: { code: "illegal_reward_transition", from: "archived", to: "active" } });
    expect(status("active", "active")).toEqual({ ok: false, error: { code: "illegal_reward_transition", from: "active", to: "active" } });
  });

  test("S45: the status write is a compare-and-set from the current status", () => {
    const d = decideSetRewardStatus({ reward: reward({ status: "draft" }) }, { type: "SetRewardStatus", ...base("web:status", admin), rewardId: "rw-1", status: "active" }, NOW);
    expect(d.writes).toEqual([{ t: "shop.reward.status", rewardId: "rw-1", from: "draft", to: "active" }]);
  });
});

describe("S46 restock", () => {
  const restock = (r = reward({ stock: 0 }), variantId: string | null = null, quantity = 3) =>
    decideRestock({ reward: r }, { type: "Restock", ...base("web:restock", admin), rewardId: "rw-1", variantId, quantity: quantity as PosInt }, NOW);

  test("S46: restocking adds units to the reward or to one variant", () => {
    expect(restock().outcome).toEqual({ ok: true, value: { rewardId: "rw-1", variantId: null, stock: 3 } });
    expect(restock().writes).toEqual([{ t: "shop.stock.add", rewardId: "rw-1", variantId: null, quantity: 3 }]);
    const withVariants = reward({ variants: [{ id: "s", name: "S", stock: 1 }] });
    expect(restock(withVariants, "s", 2).outcome).toEqual({ ok: true, value: { rewardId: "rw-1", variantId: "s", stock: 3 } });
    expect(restock(withVariants, null).outcome).toEqual({ ok: false, error: { code: "invalid_variant" } });
  });

  test("S46: unlimited stock cannot be restocked, archived rewards neither", () => {
    expect(restock(reward({ stock: null })).outcome).toEqual({ ok: false, error: { code: "invalid_reward", field: "stock" } });
    expect(restock(reward({ stock: 0, status: "archived" })).outcome).toEqual({ ok: false, error: { code: "reward_not_active" } });
  });
});

describe("S47 budget setting", () => {
  test("S47: the monthly budget is integer minor units with an ISO currency", () => {
    const cfg = (minor: number, currency = "PEN") => decideConfigureShop(null, { type: "ConfigureShop", ...base("web:cfg", admin), settings: shopSettings({ monthlyBudget: { minor, currency } }) }, NOW);
    expect(cfg(50000).outcome).toEqual({ ok: true, value: { autoApprove: false, monthlyBudget: { minor: 50000, currency: "PEN" } } });
    expect(cfg(50000).writes).toEqual([{ t: "shop.settings.put", settings: { autoApprove: false, monthlyBudget: { minor: 50000, currency: "PEN" } } }]);
    expect(cfg(99.5).outcome).toEqual({ ok: false, error: { code: "invalid_reward", field: "monthlyBudget" } });
    expect(cfg(100, "soles").outcome).toEqual({ ok: false, error: { code: "invalid_reward", field: "monthlyBudget" } });
  });
});

describe("S44 reward edits", () => {
  const update = (changes: Record<string, unknown>, actor = admin) => ({ type: "UpdateReward", ...base("api:upd:1", actor), rewardId: "rw-1", changes }) as const;
  const snap = (over: Parameters<typeof reward>[0] = {}) => ({ rewardId: "rw-1", settings: shopSettings(), reward: reward({ id: "rw-1", ...over }) });

  test("S44: an admin edits a reward's fields; stock, variants, gift-card mode and status are kept", () => {
    const before = reward({ id: "rw-1", status: "active", stock: 4 });
    const d = decideUpdateReward({ rewardId: "rw-1", settings: shopSettings(), reward: before }, update({ title: " Dinner ", cost: 20, autoApprove: true }), NOW);
    expect(d.outcome).toEqual({ ok: true, value: { rewardId: "rw-1" } });
    expect(d.writes).toEqual([{ t: "shop.reward.update", from: "active", reward: { ...before, title: "Dinner", cost: 20, autoApprove: true } }]);
    expect(d.entries).toEqual([]);
  });

  test("S44: an edit is checked like a new reward, by an admin, and never on an archived reward (S45)", () => {
    expect(decideUpdateReward(snap(), update({ cost: 0 }), NOW).outcome).toEqual({ ok: false, error: { code: "invalid_reward", field: "cost" } });
    expect(decideUpdateReward(snap(), update({ title: "" }), NOW).outcome).toEqual({ ok: false, error: { code: "invalid_reward", field: "title" } });
    expect(decideUpdateReward(snap(), update({ cost: 5 }, memberActor("ana")), NOW).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "rewards:write" } });
    expect(decideUpdateReward(snap({ status: "archived" }), update({ cost: 5 }), NOW).outcome).toEqual({ ok: false, error: { code: "reward_not_active" } });
    expect(decideUpdateReward({ rewardId: "rw-1", settings: shopSettings(), reward: null }, update({ cost: 5 }), NOW).outcome).toEqual({ ok: false, error: { code: "reward_not_found" } });
    expect(decideUpdateReward(snap(), update({ cost: 5 }, apiToken(["rewards:write"])), NOW).outcome.ok).toBe(true);
  });

  test("S44: a reward cost is one ledger entry, so it is at most MAX_ENTRY_AMOUNT", () => {
    const s = { rewardId: "rw-9", settings: shopSettings() };
    expect(decideCreateReward(s, create({ cost: MAX_ENTRY_AMOUNT }), NOW).outcome.ok).toBe(true);
    expect(decideCreateReward(s, create({ cost: MAX_ENTRY_AMOUNT + 1 }), NOW).outcome).toEqual({ ok: false, error: { code: "invalid_reward", field: "cost" } });
    expect(decideUpdateReward(snap(), update({ cost: MAX_ENTRY_AMOUNT + 1 }), NOW).outcome).toEqual({ ok: false, error: { code: "invalid_reward", field: "cost" } });
  });
});
