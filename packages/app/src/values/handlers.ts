// S42: tag an existing gift by a value-emoji reaction. Takes the gift aggregate lock that edits and
// deletes take, so the header rewrite never races an edit's rewrite (G4).
import { decideTagByReaction, type TagGiftByReaction, type TagReceipt, type TagSnapshot } from "@propi/core/values";
import { defineHandler } from "../handler.ts";

export type ValuesResults = {
  TagGiftByReaction: TagReceipt;
};

export const valuesHandlers = [
  defineHandler<TagGiftByReaction, TagSnapshot, TagReceipt>({
    type: "TagGiftByReaction",
    locks: (cmd) => [`gift:${cmd.messageRef}`],
    async load(cmd, tx, ctx) {
      const [gift, values, tagger] = await Promise.all([
        tx.giftByMessage(cmd.messageRef),
        ctx.directory.values(cmd.workspaceId),
        cmd.actor.kind === "member" ? ctx.directory.member(cmd.workspaceId, cmd.actor.memberId) : null,
      ]);
      return { gift, values, tagger };
    },
    decide: decideTagByReaction,
  }),
];
