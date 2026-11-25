// S42: any member adds a value to an existing gift later by reacting with that value's emoji.
// Tags live on the gift header (insert-only gift_value rows in SQL); no units move.
import type { Gift } from "../giving/types.ts";
import type { MemberRecord } from "../members/members.ts";
import { accept, reject, type Decision } from "../shared/decision.ts";
import type { CommandBase, GiftId, Instant, ValueId } from "../shared/types.ts";
import type { Value } from "./values.ts";

export interface TagGiftByReaction extends CommandBase {
  readonly type: "TagGiftByReaction";
  /** The reacted message; its message gift is tagged. */
  readonly messageRef: string;
  readonly emoji: string;
}

export interface TagSnapshot {
  /** The message-sourced gift attached to messageRef, if any. */
  readonly gift: Gift | null;
  readonly values: readonly Value[];
  /** The reacting member's record; null when unknown. */
  readonly tagger: MemberRecord | null;
}

export interface TagReceipt {
  readonly giftId: GiftId;
  readonly valueId: ValueId;
  /** false when the gift already carried the value. */
  readonly added: boolean;
}

export const valueForEmoji = (emoji: string, values: readonly Value[]): Value | null => values.find((v) => v.emoji === emoji) ?? null;

export function decideTagByReaction(s: TagSnapshot, cmd: TagGiftByReaction, _now: Instant): Decision<TagReceipt> {
  if (cmd.actor.kind !== "member") return reject({ code: "forbidden", need: "member" });
  if (s.tagger === null) return reject({ code: "unknown_member", memberId: cmd.actor.memberId });
  if (!s.tagger.active) return reject({ code: "inactive_member" });
  const value = valueForEmoji(cmd.emoji, s.values);
  if (value === null) return reject({ code: "not_a_gift" });
  if (s.gift === null) return reject({ code: "gift_not_found" });
  if (s.gift.valueIds.includes(value.id)) return accept({ giftId: s.gift.id, valueId: value.id, added: false });
  return accept(
    { giftId: s.gift.id, valueId: value.id, added: true },
    { writes: [{ t: "gift.upsert", gift: { ...s.gift, valueIds: [...s.gift.valueIds, value.id] } }] },
  );
}
