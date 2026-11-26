// Slash command and Block Kit actions → intents and app commands (S28, S48, S6, S73).
// The /propi command reads (balance, shop, help) or gives a sticker; buttons redeem and review.
import type { CommandKey, GiveSticker, Instant, MemberId, Redeem, ReviewSubmission, TransitionRedemption, WorkspaceId, Actor } from "@propi/app";
import { slackKeys } from "./text.ts";
import { inboundMessage } from "./translate.ts";
import type { SlackBlockAction, SlackLookup, SlackSlashCommand } from "./types.ts";

export const ACTIONS = {
  redeem: "propi_redeem",
  /** S2: the "Redeem more" picker; each option is `<redeemValue>#<quantity>`. */
  redeemQuantity: "propi_redeem_quantity",
  approveRedemption: "propi_redemption_approve",
  rejectRedemption: "propi_redemption_reject",
  fulfilRedemption: "propi_redemption_fulfil",
  approveSubmission: "propi_submission_approve",
  rejectSubmission: "propi_submission_reject",
  openShop: "propi_open_shop",
} as const;

export type SlashIntent =
  | { readonly kind: "balance" }
  | { readonly kind: "shop" }
  | { readonly kind: "help" }
  | { readonly kind: "sticker"; readonly stickerId: string; readonly rest: string };

/** `/propi [balance | shop | help | sticker <id> @people …]`; empty means balance. */
export function parseSlash(text: string): SlashIntent {
  const [head = "", ...rest] = text.trim().split(/\s+/);
  switch (head.toLowerCase()) {
    case "":
    case "balance":
      return { kind: "balance" };
    case "shop":
      return { kind: "shop" };
    case "sticker": {
      const [stickerId, ...more] = rest;
      return stickerId === undefined ? { kind: "help" } : { kind: "sticker", stickerId, rest: more.join(" ") };
    }
    default:
      return { kind: "help" };
  }
}

/** S73: `/propi sticker <id> @a @b note` → GiveSticker. Mentions need the command's escaping on. */
export async function stickerCommand(lookup: SlackLookup, ws: WorkspaceId, actor: Actor, cmd: SlackSlashCommand, intent: Extract<SlashIntent, { kind: "sticker" }>, now: Instant): Promise<GiveSticker> {
  const kind = await lookup.channelKind(cmd.team_id, cmd.channel_id);
  const msg = await inboundMessage(lookup, ws, cmd.team_id, { id: cmd.channel_id, kind }, intent.rest);
  return {
    type: "GiveSticker",
    key: slackKeys.sticker(cmd.team_id, cmd.user_id, cmd.trigger_id) as CommandKey,
    workspaceId: ws,
    actor,
    at: now,
    messageRef: `${cmd.team_id}:${cmd.channel_id}:sticker:${cmd.trigger_id}`,
    stickerId: intent.stickerId,
    channel: { id: cmd.channel_id, kind },
    mentions: msg.mentions,
    channelMembers: await lookup.channelMembers(ws, cmd.team_id, cmd.channel_id),
  };
}

/** Redeem button values carry the reward and, for a variant, `<rewardId>|<variantId>`. */
export const redeemValue = (rewardId: string, variantId: string | null) => (variantId === null ? rewardId : `${rewardId}|${variantId}`);
/** S2: a quantity picker option: the redeem value plus `#<quantity>`. */
export const redeemQuantityValue = (rewardId: string, variantId: string | null, quantity: number) => `${redeemValue(rewardId, variantId)}#${quantity}`;

export type ActionCommand = Redeem | TransitionRedemption | ReviewSubmission;

/**
 * S48, S6: a button press → the command it stands for, or null for actions that only navigate.
 * The actor is the member who pressed; core checks the role (approver/admin) and the state.
 */
export function actionCommand(payload: SlackBlockAction, ws: WorkspaceId, actor: Actor, now: Instant): ActionCommand | null {
  const action = payload.actions[0];
  const team = payload.team?.id ?? payload.user.team_id ?? "";
  const user = payload.user.id;
  const value = action?.value ?? action?.selected_option?.value;
  if (action === undefined || value === undefined) return null;
  const base = { workspaceId: ws, actor, at: now };
  switch (action.action_id) {
    case ACTIONS.redeem: {
      if (actor.kind !== "member") return null;
      const [rewardId = "", variantId = null] = value.split("|");
      return { type: "Redeem", key: slackKeys.redeem(team, user, action.action_ts) as CommandKey, ...base, memberId: actor.memberId as MemberId, rewardId, variantId };
    }
    case ACTIONS.redeemQuantity: {
      // Core validates the quantity (S2); a malformed option becomes a refused Redeem, not a crash.
      if (actor.kind !== "member") return null;
      const cut = value.lastIndexOf("#");
      const [rewardId = "", variantId = null] = (cut < 0 ? value : value.slice(0, cut)).split("|");
      const quantity = cut < 0 ? 1 : Number(value.slice(cut + 1));
      return { type: "Redeem", key: slackKeys.redeem(team, user, action.action_ts) as CommandKey, ...base, memberId: actor.memberId as MemberId, rewardId, variantId, quantity };
    }
    case ACTIONS.approveRedemption:
    case ACTIONS.rejectRedemption:
    case ACTIONS.fulfilRedemption: {
      const transition = action.action_id === ACTIONS.approveRedemption ? "approve" : action.action_id === ACTIONS.rejectRedemption ? "reject" : "fulfil";
      return {
        type: "TransitionRedemption",
        key: slackKeys.review(team, user, "redemption", value, transition) as CommandKey,
        ...base,
        redemptionId: value,
        transition,
        reason: null,
      };
    }
    case ACTIONS.approveSubmission:
    case ACTIONS.rejectSubmission: {
      const verdict = action.action_id === ACTIONS.approveSubmission ? "approve" : "reject";
      return {
        type: "ReviewSubmission",
        key: slackKeys.review(team, user, "submission", value, verdict) as CommandKey,
        ...base,
        submissionId: value,
        verdict,
        amount: null,
        note: null,
      };
    }
    default:
      return null;
  }
}
