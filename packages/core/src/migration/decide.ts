// Pure deciders for imported HeyTaco history (S76a, S104). History is accepted as recorded:
// no allowance, no S35 guard, no notifications.
import { accept, reject, type Decision } from "../shared/decision.ts";
import type { Actor, Instant } from "../shared/types.ts";
import { isPosInt } from "../shared/types.ts";
import { canAdjust } from "../members/members.ts";
import type {
  ImportHeyTacoBonus,
  ImportHeyTacoGift,
  ImportHeyTacoRedemption,
  ImportedBonusResult,
  ImportedGiftResult,
  ImportedRedemptionResult,
} from "./types.ts";

function guard<T>(actor: Actor, amount: number): Decision<T> | null {
  if (!canAdjust(actor)) return reject({ code: "forbidden", need: "admin" });
  if (!isPosInt(amount)) return reject({ code: "invalid_amount" });
  return null;
}

export interface ImportGiftSnapshot {
  /** S14, S70: whether gift text is kept at all. */
  readonly storeMessageText: boolean;
}

/** S76a: every activity row (message, reaction or sticker) is one gift; it consumes no allowance day. */
export function decideImportGift(s: ImportGiftSnapshot, cmd: ImportHeyTacoGift, _now: Instant): Decision<ImportedGiftResult> {
  const denied = guard<ImportedGiftResult>(cmd.actor, cmd.amount);
  if (denied) return denied;
  const amount = cmd.amount as ImportedGiftResult["amount"];
  return accept(
    { giftId: cmd.giftId, amount },
    {
      entries: [{ kind: "gift", amount, memberId: cmd.receiver, counterpartId: cmd.giver, cause: { type: "gift", giftId: cmd.giftId }, source: cmd.source, allowanceDay: null, reason: null }],
      writes: [
        {
          t: "gift.upsert",
          gift: {
            id: cmd.giftId,
            giver: cmd.giver,
            messageRef: null,
            source: cmd.source,
            emoji: null,
            channelId: cmd.channel,
            isPrivate: false,
            text: s.storeMessageText ? cmd.text : null,
            valueIds: [],
            allowanceDay: null,
            createdAt: cmd.at,
            closedBy: null,
          },
        },
      ],
    },
  );
}

/** S104: an imported redemption spends what HeyTaco recorded and keeps its fulfilled state. */
export function decideImportRedemption(_s: object, cmd: ImportHeyTacoRedemption, _now: Instant): Decision<ImportedRedemptionResult> {
  const denied = guard<ImportedRedemptionResult>(cmd.actor, cmd.amount);
  if (denied) return denied;
  return accept(
    { redemptionId: cmd.redemptionId, state: cmd.state },
    {
      entries: [
        {
          kind: "spend",
          amount: cmd.amount as ImportedBonusResult["amount"],
          memberId: cmd.memberId,
          counterpartId: null,
          cause: { type: "redemption", redemptionId: cmd.redemptionId },
          source: null,
          allowanceDay: null,
          reason: cmd.title,
        },
      ],
    },
  );
}

/** HeyTaco exports only a per-user bonus total; it becomes one bonus entry. */
export function decideImportBonus(_s: object, cmd: ImportHeyTacoBonus, _now: Instant): Decision<ImportedBonusResult> {
  const denied = guard<ImportedBonusResult>(cmd.actor, cmd.amount);
  if (denied) return denied;
  const amount = cmd.amount as ImportedBonusResult["amount"];
  return accept(
    { memberId: cmd.memberId, amount },
    { entries: [{ kind: "bonus", amount, memberId: cmd.memberId, counterpartId: null, cause: { type: "import", source: "heytaco" }, source: null, allowanceDay: null, reason: "HeyTaco bonus total" }] },
  );
}
