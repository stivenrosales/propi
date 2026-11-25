// Giving use cases: lock -> claim -> load -> decide -> commit, wired to the core deciders.
import {
  decideDeleteMessage,
  decideEditMessage,
  decideGiveByMessage,
  decideGiveByReaction,
  decideRemoveReaction,
  giverIdOf,
  localDate,
  reactionKey,
  type Actor,
  type CommandKey,
  type DeleteMessage,
  type EditMessage,
  type EditReceipt,
  type GiftId,
  type GiftReceipt,
  type GiveByMessage,
  type GiveByReaction,
  type GiveSnapshot,
  type LockKey,
  type ReactionSnapshot,
  type MemberId,
  type Mention,
  type RemoveReaction,
  type ReversalReceipt,
  type ReversalSnapshot,
  type Tx,
} from "@propi/core";
import { defineHandler, type LoadContext } from "../handler.ts";

export type GivingResults = {
  GiveByMessage: GiftReceipt;
  GiveByReaction: GiftReceipt;
  RemoveReaction: ReversalReceipt;
  EditMessage: EditReceipt;
  DeleteMessage: ReversalReceipt;
};

/** G4: the message aggregate first, then the giver. */
function giftLocks(messageRef: string, actor: Actor): LockKey[] {
  const giver = giverIdOf(actor);
  return giver === null ? [`gift:${messageRef}`] : [`gift:${messageRef}`, `member:${giver}`];
}

function candidateIds(mentions: readonly Mention[], extra: readonly (MemberId | null)[] = []): MemberId[] {
  const ids = new Set<MemberId>();
  for (const mn of mentions) {
    if (mn.kind === "member") ids.add(mn.memberId);
    if (mn.kind === "group") for (const id of mn.memberIds) ids.add(id);
  }
  for (const id of extra) if (id !== null) ids.add(id);
  return [...ids];
}

async function loadGive(actor: Actor, candidates: readonly MemberId[], tx: Tx, ctx: LoadContext, ws: GiveByMessage["workspaceId"]): Promise<GiveSnapshot> {
  const giverId = giverIdOf(actor);
  const giverRecord = actor.kind === "member" ? await ctx.directory.member(ws, actor.memberId) : null;
  const activeMembers = new Set<MemberId>();
  for (const id of candidates) if ((await ctx.directory.member(ws, id))?.active) activeMembers.add(id);
  const day = localDate(ctx.now, ctx.settings.timezone);
  return {
    settings: ctx.settings,
    giverRecord,
    activeMembers,
    values: await ctx.directory.values(ws),
    allowanceUsed: giverId === null ? 0 : await tx.allowanceUsed(giverId, day),
    newGiftId: ctx.ids.next("gift") as GiftId,
  };
}

async function reversalOf(tx: Tx, ctx: LoadContext, gift: Awaited<ReturnType<Tx["gift"]>>): Promise<ReversalSnapshot> {
  return { settings: ctx.settings, gift, net: gift === null ? new Map() : await tx.netPerReceiver(gift.id) };
}

/** G8: the n-th same-day occurrence of a (giver, message, emoji) reaction gets its own key. */
async function occurrenceKey(cmd: GiveByReaction | RemoveReaction, tx: Tx, ctx: LoadContext): Promise<CommandKey> {
  const giver = giverIdOf(cmd.actor);
  if (giver === null) return cmd.key;
  const n = await tx.reactionReversals(giver, cmd.messageRef, cmd.emoji, localDate(ctx.now, ctx.settings.timezone));
  return reactionKey(cmd.key, n);
}

export const givingHandlers = [
  defineHandler<GiveByMessage, GiveSnapshot, GiftReceipt>({
    type: "GiveByMessage",
    locks: (cmd) => giftLocks(cmd.messageRef, cmd.actor),
    load: (cmd, tx, ctx) => loadGive(cmd.actor, candidateIds(cmd.message.mentions), tx, ctx, cmd.workspaceId),
    decide: decideGiveByMessage,
  }),

  defineHandler<GiveByReaction, ReactionSnapshot, GiftReceipt>({
    type: "GiveByReaction",
    locks: (cmd) => giftLocks(cmd.messageRef, cmd.actor),
    resolveKey: occurrenceKey,
    async load(cmd, tx, ctx) {
      const base = await loadGive(cmd.actor, candidateIds(cmd.target.mentions, [cmd.target.author]), tx, ctx, cmd.workspaceId);
      const giver = giverIdOf(cmd.actor);
      const alreadyGifted = giver !== null && (await tx.activeReactionGift(giver, cmd.messageRef, cmd.emoji)) !== null;
      const closedByAdmin = giver !== null && (await tx.reactionClosedByAdmin(giver, cmd.messageRef, cmd.emoji));
      return { ...base, alreadyGifted, closedByAdmin };
    },
    decide: decideGiveByReaction,
  }),

  defineHandler<RemoveReaction, ReversalSnapshot, ReversalReceipt>({
    type: "RemoveReaction",
    locks: (cmd) => giftLocks(cmd.messageRef, cmd.actor),
    resolveKey: occurrenceKey,
    async load(cmd, tx, ctx) {
      const giver = giverIdOf(cmd.actor);
      return reversalOf(tx, ctx, giver === null ? null : await tx.activeReactionGift(giver, cmd.messageRef, cmd.emoji));
    },
    decide: decideRemoveReaction,
  }),

  defineHandler<EditMessage, Parameters<typeof decideEditMessage>[0], EditReceipt>({
    type: "EditMessage",
    locks: (cmd) => giftLocks(cmd.messageRef, cmd.actor),
    async load(cmd, tx, ctx) {
      const base = await loadGive(cmd.actor, candidateIds(cmd.message.mentions), tx, ctx, cmd.workspaceId);
      const gift = await tx.giftByMessage(cmd.messageRef);
      return { ...base, gift, net: gift === null ? new Map() : await tx.netPerReceiver(gift.id) };
    },
    decide: decideEditMessage,
  }),

  defineHandler<DeleteMessage, ReversalSnapshot, ReversalReceipt>({
    type: "DeleteMessage",
    locks: (cmd) => giftLocks(cmd.messageRef, cmd.actor),
    load: async (cmd, tx, ctx) => reversalOf(tx, ctx, await tx.giftByMessage(cmd.messageRef)),
    decide: decideDeleteMessage,
  }),
];
