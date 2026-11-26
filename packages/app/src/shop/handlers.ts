// Shop use cases: lock -> claim -> load -> decide -> commit, wired to the core shop deciders.
// Lock order (G4): aggregate (redemption/collab/reward) -> budget/prepaid -> member.
import type { CommandBase, Instant, LockKey, MemberId, Tx, WorkspaceId } from "@propi/core";
import type { HandlerClock, LoadContext, LockContext, RegisteredHandler } from "../handler.ts";
import {
  budgetMonth,
  decideCloseCollab,
  decideConfigureShop,
  decideContribute,
  decideCreateCollab,
  decideCreateReward,
  decideRecordGiftCardIssued,
  decideRedeem,
  decideRestock,
  decideSetRewardStatus,
  decideTransition,
  decideUpdateReward,
  isShopReader,
  type CloseCollab,
  type ConfigureShop,
  type Contribute,
  type CreateCollab,
  type CreateReward,
  type RecordGiftCardIssued,
  type Redeem,
  type Restock,
  type RewardId,
  type SetRewardStatus,
  type ShopDecision,
  type ShopReader,
  type ShopResults,
  type TransitionRedemption,
  type UpdateReward,
} from "./core.ts";

export type { ShopResults };

/** The shop reads ride on the Tx and on the lock-time reader; fail loudly when the store is not wired. */
export function asShop<T extends object>(x: T): T & ShopReader {
  if (!isShopReader(x)) throw new Error("shop store is not wired: the unit of work and reader must implement ShopReader");
  return x;
}

export interface ShopHandler<C extends CommandBase & { readonly type: string }, S, T> {
  readonly type: C["type"];
  readonly clock?: HandlerClock;
  locks(cmd: C, ctx: LockContext): Promise<readonly LockKey[]> | readonly LockKey[];
  load(cmd: C, tx: Tx & ShopReader, ctx: LoadContext): Promise<S>;
  decide(snapshot: S, cmd: C, now: Instant): ShopDecision<T>;
}

/**
 * Like defineHandler, for deciders that write shop state (ShopWrite): the Tx is checked to carry the
 * shop store. Other modules that create shop records (e.g. the HeyTaco import, S104) use it too.
 */
export function defineShopHandler<C extends CommandBase & { readonly type: string }, S, T>(h: ShopHandler<C, S, T>): RegisteredHandler {
  return {
    type: h.type,
    ...(h.clock === undefined ? {} : { clock: h.clock }),
    locks: h.locks,
    load: (cmd: C, tx: Tx, ctx: LoadContext) => h.load(cmd, asShop(tx), ctx),
    decide: h.decide,
  } as unknown as RegisteredHandler;
}

const rewardKey = (id: RewardId): LockKey => `redemption:reward:${id}`;
const memberKey = (id: MemberId): LockKey => `member:${id}`;
const budgetKey = (ws: WorkspaceId, month: string): LockKey => `budget:${ws}:${month}`;

async function contributorKeys(reader: ShopReader, collabId: string): Promise<LockKey[]> {
  return [...(await reader.contributions(collabId)).keys()].map(memberKey);
}

export const shopHandlers: readonly RegisteredHandler[] = [
  defineShopHandler<ConfigureShop, null, ShopResults["ConfigureShop"]>({
    type: "ConfigureShop",
    locks: () => [],
    load: async () => null,
    decide: decideConfigureShop,
  }),

  defineShopHandler<CreateReward, { rewardId: RewardId; settings: Awaited<ReturnType<ShopReader["shopSettings"]>> }, ShopResults["CreateReward"]>({
    type: "CreateReward",
    locks: () => [],
    load: async (_cmd, tx, ctx) => ({ rewardId: ctx.ids.next("reward"), settings: await tx.shopSettings() }),
    decide: decideCreateReward,
  }),

  // S44, S97: field edits serialize with status changes, restocks and redemptions of that reward.
  defineShopHandler<UpdateReward, Parameters<typeof decideUpdateReward>[0], ShopResults["UpdateReward"]>({
    type: "UpdateReward",
    locks: (cmd) => [rewardKey(cmd.rewardId)],
    load: async (cmd, tx, ctx) => ({ rewardId: cmd.rewardId, settings: await tx.shopSettings(), reward: await tx.reward(cmd.rewardId) }),
    decide: decideUpdateReward,
  }),

  // The reward key serializes status changes and restocks with redemptions of that reward.
  defineShopHandler<SetRewardStatus, { reward: Awaited<ReturnType<ShopReader["reward"]>> }, ShopResults["SetRewardStatus"]>({
    type: "SetRewardStatus",
    locks: (cmd) => [rewardKey(cmd.rewardId)],
    load: async (cmd, tx) => ({ reward: await tx.reward(cmd.rewardId) }),
    decide: decideSetRewardStatus,
  }),

  defineShopHandler<Restock, { reward: Awaited<ReturnType<ShopReader["reward"]>> }, ShopResults["Restock"]>({
    type: "Restock",
    locks: (cmd) => [rewardKey(cmd.rewardId)],
    load: async (cmd, tx) => ({ reward: await tx.reward(cmd.rewardId) }),
    decide: decideRestock,
  }),

  defineShopHandler<Redeem, Parameters<typeof decideRedeem>[0], ShopResults["Redeem"]>({
    type: "Redeem",
    // S50 / G4: reward -> budget month (S47) -> prepaid (S108) -> member (S35).
    async locks(cmd, ctx) {
      const shop = asShop(ctx.reader);
      const settings = await shop.shopSettings();
      const reward = await shop.reward(cmd.rewardId);
      const keys: LockKey[] = [rewardKey(cmd.rewardId)];
      if (settings.monthlyBudget !== null) keys.push(budgetKey(cmd.workspaceId, budgetMonth(cmd.at, ctx.settings.timezone)));
      if (reward?.giftCard === true) keys.push(`prepaid:${cmd.workspaceId}`);
      keys.push(memberKey(cmd.memberId));
      return keys;
    },
    async load(cmd, tx, ctx) {
      // The budget month follows the command's time, the same month whose key was locked.
      const month = budgetMonth(cmd.at, ctx.settings.timezone);
      return {
        member: await ctx.directory.member(cmd.workspaceId, cmd.memberId),
        redeemable: (await tx.balances(cmd.memberId)).redeemable,
        reward: await tx.reward(cmd.rewardId),
        settings: await tx.shopSettings(),
        budgetMonth: month,
        budgetSpent: await tx.budgetSpent(month),
        prepaidAvailable: await tx.prepaidAvailable(),
        redemptionId: ctx.ids.next("redemption"),
        plan: ctx.plan === undefined ? null : await ctx.plan(cmd.workspaceId),
      };
    },
    decide: decideRedeem,
  }),

  defineShopHandler<TransitionRedemption, Parameters<typeof decideTransition>[0], ShopResults["TransitionRedemption"]>({
    type: "TransitionRedemption",
    // G4: reject and cancel take the member key like redeem; the reward key covers the stock release.
    async locks(cmd, ctx) {
      const shop = asShop(ctx.reader);
      const r = await shop.redemption(cmd.redemptionId);
      const keys: LockKey[] = [`redemption:${cmd.redemptionId}`];
      if (r === null) return keys;
      if (r.rewardId !== null && r.stockReserved) keys.push(rewardKey(r.rewardId));
      if (r.collabId !== null) keys.push(`collab:${r.collabId}`, ...(await contributorKeys(shop, r.collabId)));
      if (r.memberId !== null) keys.push(memberKey(r.memberId));
      return keys;
    },
    async load(cmd, tx) {
      const redemption = await tx.redemption(cmd.redemptionId);
      const collabId = redemption?.collabId ?? null;
      return {
        redemption,
        collab: collabId === null ? null : await tx.collab(collabId),
        contributions: collabId === null ? new Map() : await tx.contributions(collabId),
      };
    },
    decide: decideTransition,
  }),

  defineShopHandler<RecordGiftCardIssued, { redemption: Awaited<ReturnType<ShopReader["redemption"]>> }, ShopResults["RecordGiftCardIssued"]>({
    type: "RecordGiftCardIssued",
    locks: (cmd) => [`redemption:${cmd.redemptionId}`],
    load: async (cmd, tx) => ({ redemption: await tx.redemption(cmd.redemptionId) }),
    decide: decideRecordGiftCardIssued,
  }),

  defineShopHandler<CreateCollab, { collabId: string }, ShopResults["CreateCollab"]>({
    type: "CreateCollab",
    locks: () => [],
    load: async (_cmd, _tx, ctx) => ({ collabId: ctx.ids.next("collab") }),
    decide: decideCreateCollab,
  }),

  defineShopHandler<Contribute, Parameters<typeof decideContribute>[0], ShopResults["Contribute"]>({
    type: "Contribute",
    // G4: the collab aggregate first (goal check, S59), then the member (S35).
    locks: (cmd) => [`collab:${cmd.collabId}`, memberKey(cmd.memberId)],
    async load(cmd, tx, ctx) {
      return {
        member: await ctx.directory.member(cmd.workspaceId, cmd.memberId),
        redeemable: (await tx.balances(cmd.memberId)).redeemable,
        collab: await tx.collab(cmd.collabId),
        contributions: await tx.contributions(cmd.collabId),
        redemptionId: ctx.ids.next("redemption"),
        plan: ctx.plan === undefined ? null : await ctx.plan(cmd.workspaceId),
      };
    },
    decide: decideContribute,
  }),

  defineShopHandler<CloseCollab, Parameters<typeof decideCloseCollab>[0], ShopResults["CloseCollab"]>({
    type: "CloseCollab",
    async locks(cmd, ctx) {
      return [`collab:${cmd.collabId}`, ...(await contributorKeys(asShop(ctx.reader), cmd.collabId))];
    },
    async load(cmd, tx) {
      return { collab: await tx.collab(cmd.collabId), contributions: await tx.contributions(cmd.collabId) };
    },
    decide: decideCloseCollab,
  }),
];
