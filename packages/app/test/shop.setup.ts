// Shared synthetic setup for shop use-case tests. No real data.
import { defaultSettings, type Actor, type MemberId, type PosInt } from "@propi/core";
import { createApp } from "../src/index.ts";
import { createMemoryPorts, type MemoryOptions } from "../src/testing/index.ts";
import type { ShopCommand, ShopFailure, ShopResults } from "../src/shop/index.ts";
import { createGiftCardFake } from "../src/testing/shop.ts";
import { T0, WS, admin, key, m, memberActor } from "./setup.ts";

export { T0, WS, admin, key, m, memberActor };
export const approver = memberActor("rita", "approver");
export const system: Actor = { kind: "system", job: "test" };

export type ShopResult<C extends ShopCommand> =
  | { readonly ok: true; readonly replayed: boolean; readonly value: ShopResults[C["type"]] }
  | { readonly ok: false; readonly replayed: boolean; readonly error: ShopFailure };

export function shopSetup(opts: MemoryOptions & { prepaid?: number; members?: string[]; inactive?: string[] } = {}) {
  const giftCards = opts.prepaid === undefined ? null : createGiftCardFake({ minor: opts.prepaid, currency: "PEN" });
  // The memory ports carry the shop store; shopHandlers are registered in HANDLERS.
  const mem = createMemoryPorts({ now: T0, ...opts, giftCards });
  mem.addWorkspace(WS, defaultSettings({ timezone: "America/Lima" }));
  for (const id of ["ana", "bob", "diana", "lind", ...(opts.members ?? [])]) mem.addMember(WS, { id: m(id), role: "member", active: !(opts.inactive ?? []).includes(id), dailyLimitOverride: null });
  mem.addMember(WS, { id: m("boss"), role: "admin", active: true, dailyLimitOverride: null });
  mem.addMember(WS, { id: m("rita"), role: "approver", active: true, dailyLimitOverride: null });
  mem.addMember(WS, { id: m("gone"), role: "member", active: false, dailyLimitOverride: null });
  const store = mem.shop;
  const app = createApp(mem.ports);
  const run = <C extends ShopCommand>(cmd: C) => app.executeAny(cmd) as Promise<ShopResult<C>>;

  let n = 0;
  const fund = async (id: string, amount: number) => {
    await app.execute({ type: "GrantBonus", key: key(`test:fund:${++n}`), workspaceId: WS, actor: admin, at: T0, memberIds: [m(id)], amount: amount as PosInt, reason: "fund" });
  };
  const redeemable = async (id: string) => (await app.balances(WS, m(id))).redeemable;

  return { mem, store, app, run, fund, redeemable, giftCards };
}

let seq = 0;
const base = (k: string, actor: Actor) => ({ key: key(k), workspaceId: WS, actor, at: T0 });

export const createReward = (over: Partial<Parameters<typeof rewardIn>[0]> = {}, actor: Actor = admin) =>
  ({ type: "CreateReward", ...base(`web:reward:${++seq}`, actor), reward: rewardIn(over) }) as const;

function rewardIn(over: Partial<{ title: string; cost: number; stock: number | null; variants: { id: string; name: string; stock: number | null }[]; internalCost: { minor: number; currency: string } | null; autoApprove: boolean | null; giftCard: boolean }>) {
  return {
    title: "Lunch voucher",
    description: "Lunch for two",
    image: null,
    cost: 12,
    stock: null,
    variants: [],
    categories: ["food"],
    internalCost: { minor: 2500, currency: "PEN" },
    instructions: "Show this at the counter",
    autoApprove: null,
    giftCard: false,
    ...over,
  };
}

export const setStatus = (rewardId: string, status: "active" | "archived") => ({ type: "SetRewardStatus", ...base(`web:status:${++seq}`, admin), rewardId, status }) as const;
export const restock = (rewardId: string, quantity: number, variantId: string | null = null) =>
  ({ type: "Restock", ...base(`web:restock:${++seq}`, admin), rewardId, variantId, quantity: quantity as PosInt }) as const;
export const configure = (over: { autoApprove?: boolean; monthlyBudget?: { minor: number; currency: string } | null }) =>
  ({ type: "ConfigureShop", ...base(`web:cfg:${++seq}`, admin), settings: { autoApprove: false, monthlyBudget: null, ...over } }) as const;
export const redeem = (who: string, rewardId: string, k = `web:redeem:${who}:${++seq}`, actor: Actor = memberActor(who), variantId: string | null = null) =>
  ({ type: "Redeem", ...base(k, actor), memberId: m(who) as MemberId, rewardId, variantId }) as const;
export const transition = (redemptionId: string, t: "approve" | "reject" | "cancel" | "fulfil", actor: Actor = admin, k = `redemption:${redemptionId}:${t}`) =>
  ({ type: "TransitionRedemption", ...base(k, actor), redemptionId, transition: t, reason: t === "reject" || t === "cancel" ? "test" : null }) as const;
export const createCollab = (goal: number, over: { deadline?: number | null; autoApprove?: boolean } = {}) =>
  ({ type: "CreateCollab", ...base(`web:collab:${++seq}`, admin), title: "Team dinner", description: "", goal, deadline: (over.deadline ?? null) as never, autoApprove: over.autoApprove ?? false }) as const;
export const contribute = (who: string, collabId: string, amount: number, k = `web:contrib:${who}:${++seq}`) =>
  ({ type: "Contribute", ...base(k, memberActor(who)), collabId, memberId: m(who) as MemberId, amount }) as const;
export const closeCollab = (collabId: string, why: "archived" | "deadline", actor: Actor = admin) => ({ type: "CloseCollab", ...base(`collab:${collabId}:refund`, actor), collabId, why }) as const;

/** An active reward, created and published through the app. */
export async function activeReward(run: ReturnType<typeof shopSetup>["run"], over: Parameters<typeof createReward>[0] = {}): Promise<string> {
  const r = await run(createReward(over));
  if (!r.ok) throw new Error(`createReward failed: ${JSON.stringify(r.error)}`);
  const p = await run(setStatus(r.value.rewardId, "active"));
  if (!p.ok) throw new Error("publish failed");
  return r.value.rewardId;
}
