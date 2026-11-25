// Sticker use cases (S73-S76). Giving a sticker takes the same locks as a message gift
// (gift aggregate, then the giver), so the monthly quota check is serialized per giver.
import { localMonth, type Decision, type GiftId, type MemberId } from "@propi/core";
import { defineHandler } from "../handler.ts";
import type { ModuleDecision } from "../rules/core.ts";
import {
  decideConfigureStickers,
  decideDefineSticker,
  decideGiveSticker,
  decideGrantStickerUses,
  type ConfigureStickers,
  type DefineSticker,
  type GiveSticker,
  type GiveStickerSnapshot,
  type GrantSnapshot,
  type GrantStickerUses,
  type StickerConfig,
  type StickerReceipt,
  type StickerStore,
} from "./core.ts";

export interface StickerDeps {
  readonly stickers: StickerStore;
}

export type StickerResults = {
  ConfigureStickers: StickerConfig;
  DefineSticker: { stickerId: string };
  GrantStickerUses: { month: string; uses: number };
  GiveSticker: StickerReceipt;
};

const widen = <T>(d: ModuleDecision<T, unknown, unknown>): Decision<T> => d as unknown as Decision<T>;

export function stickerHandlers(deps: StickerDeps) {
  return [
    defineHandler<ConfigureStickers, null, StickerResults["ConfigureStickers"]>({
      type: "ConfigureStickers",
      locks: () => [],
      load: async () => null,
      decide: (_s, cmd, now) => widen(decideConfigureStickers(cmd, now)),
    }),

    defineHandler<DefineSticker, null, StickerResults["DefineSticker"]>({
      type: "DefineSticker",
      locks: () => [],
      load: async () => null,
      decide: (_s, cmd, now) => widen(decideDefineSticker(cmd, now)),
    }),

    defineHandler<GrantStickerUses, GrantSnapshot, StickerResults["GrantStickerUses"]>({
      type: "GrantStickerUses",
      locks: (cmd) => [`member:${cmd.memberId}`],
      load: async (cmd, _tx, ctx) => ({
        settings: ctx.settings,
        sticker: await deps.stickers.sticker(cmd.workspaceId, cmd.stickerId),
        member: await ctx.directory.member(cmd.workspaceId, cmd.memberId),
      }),
      decide: (s, cmd, now) => widen(decideGrantStickerUses(s, cmd, now)),
    }),

    defineHandler<GiveSticker, GiveStickerSnapshot, StickerResults["GiveSticker"]>({
      type: "GiveSticker",
      locks: (cmd) => (cmd.actor.kind === "member" ? [`gift:${cmd.messageRef}`, `member:${cmd.actor.memberId}`] : [`gift:${cmd.messageRef}`]),
      async load(cmd, _tx, ctx) {
        const ws = cmd.workspaceId;
        const giver = cmd.actor.kind === "member" ? cmd.actor.memberId : null;
        const candidates = new Set<MemberId>(cmd.channelMembers);
        for (const mn of cmd.mentions) {
          if (mn.kind === "member") candidates.add(mn.memberId);
          if (mn.kind === "group") for (const id of mn.memberIds) candidates.add(id);
        }
        const activeMembers = new Set<MemberId>();
        for (const id of candidates) if ((await ctx.directory.member(ws, id))?.active) activeMembers.add(id);
        const month = localMonth(ctx.now, ctx.settings.timezone);
        return {
          settings: ctx.settings,
          config: await deps.stickers.config(ws),
          sticker: await deps.stickers.sticker(ws, cmd.stickerId),
          giverRecord: giver === null ? null : await ctx.directory.member(ws, giver),
          activeMembers,
          used: giver === null ? 0 : await deps.stickers.used(ws, giver, cmd.stickerId, month),
          granted: giver === null ? 0 : await deps.stickers.granted(ws, giver, cmd.stickerId, month),
          newGiftId: ctx.ids.next("gift") as GiftId,
        };
      },
      decide: (s, cmd, now) => widen(decideGiveSticker(s, cmd, now)),
    }),
  ];
}
