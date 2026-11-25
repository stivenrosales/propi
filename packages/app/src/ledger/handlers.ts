// Admin adjustment use cases (S35-S40).
import {
  decideDeduct,
  decideGrantBonus,
  decideResetAll,
  decideReverseGift,
  type Deduct,
  type GiftId,
  type GrantBonus,
  type KnownMembersSnapshot,
  type LockKey,
  type MemberId,
  type ResetAllRedeemable,
  type ResetSnapshot,
  type ReverseGift,
  type ReverseGiftSnapshot,
  type WorkspaceId,
} from "@propi/core";
import { defineHandler, type LoadContext } from "../handler.ts";

export type LedgerResults = {
  GrantBonus: { memberIds: MemberId[]; amount: number };
  Deduct: { memberId: MemberId; amount: number };
  ReverseGift: { giftId: GiftId; reversed: number };
  ResetAllRedeemable: { members: number; total: number };
};

const memberLocks = (ids: readonly MemberId[]): LockKey[] => ids.map((id) => `member:${id}` as const);

async function known(ws: WorkspaceId, ids: readonly MemberId[], ctx: LoadContext): Promise<KnownMembersSnapshot> {
  const knownMembers = new Set<MemberId>();
  for (const id of ids) if ((await ctx.directory.member(ws, id)) !== null) knownMembers.add(id);
  return { knownMembers };
}

export const ledgerHandlers = [
  defineHandler<GrantBonus, KnownMembersSnapshot, LedgerResults["GrantBonus"]>({
    type: "GrantBonus",
    locks: (cmd) => memberLocks(cmd.memberIds),
    load: (cmd, _tx, ctx) => known(cmd.workspaceId, cmd.memberIds, ctx),
    decide: decideGrantBonus,
  }),

  defineHandler<Deduct, KnownMembersSnapshot, LedgerResults["Deduct"]>({
    type: "Deduct",
    locks: (cmd) => memberLocks([cmd.memberId]),
    load: (cmd, _tx, ctx) => known(cmd.workspaceId, [cmd.memberId], ctx),
    decide: decideDeduct,
  }),

  defineHandler<ReverseGift, ReverseGiftSnapshot, LedgerResults["ReverseGift"]>({
    type: "ReverseGift",
    // The gift aggregate lock is the same one edits and deletes take, so their net reads serialize.
    async locks(cmd, ctx) {
      const gift = await ctx.reader.gift(cmd.giftId);
      return [`gift:${gift?.messageRef ?? cmd.giftId}`];
    },
    async load(cmd, tx) {
      const gift = await tx.gift(cmd.giftId);
      return { gift, net: gift === null ? new Map() : await tx.netPerReceiver(gift.id) };
    },
    decide: decideReverseGift,
  }),

  defineHandler<ResetAllRedeemable, ResetSnapshot, LedgerResults["ResetAllRedeemable"]>({
    type: "ResetAllRedeemable",
    // §1.6: lock every member key in sorted order before reading any balance.
    async locks(cmd, ctx) {
      const ids = new Set<MemberId>((await ctx.directory.members(cmd.workspaceId)).map((r) => r.id));
      for (const id of (await ctx.reader.redeemableByMember()).keys()) ids.add(id);
      return memberLocks([...ids]);
    },
    load: async (_cmd, tx) => ({ redeemable: await tx.redeemableByMember() }),
    decide: decideResetAll,
  }),
];
