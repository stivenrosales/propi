// /propi and button payloads (recorded shapes) → intents and commands (S6, S48, S73).
import { describe, expect, test } from "vitest";
import type { Actor, Instant } from "@propi/app";
import { actionCommand, parseSlash, stickerCommand, type SlackBlockAction, type SlackSlashCommand } from "../src/index.ts";
import { WS, fakeLookup, fixture } from "./lookup.ts";

const NOW = 1764083600000 as Instant;
const ana: Actor = { kind: "member", memberId: "ana" as never, role: "member" };
const boss: Actor = { kind: "member", memberId: "boss" as never, role: "admin" };

describe("/propi", () => {
  test("S28: balance is the default; shop and help; unknown words show help", () => {
    expect(parseSlash("")).toEqual({ kind: "balance" });
    expect(parseSlash(" Balance ")).toEqual({ kind: "balance" });
    expect(parseSlash("shop")).toEqual({ kind: "shop" });
    expect(parseSlash("what")).toEqual({ kind: "help" });
    expect(parseSlash("sticker")).toEqual({ kind: "help" });
  });

  test("S73: /propi sticker <id> @someone → GiveSticker with resolved mentions and channel members", async () => {
    const cmd = fixture<SlackSlashCommand>("slash.sticker.json");
    const intent = parseSlash(cmd.text);
    expect(intent).toEqual({ kind: "sticker", stickerId: "st-thanks", rest: "<@U0ANA00001|ana> for the demo" });
    if (intent.kind !== "sticker") throw new Error("expected a sticker intent");
    expect(await stickerCommand(fakeLookup(), WS, ana, cmd, intent, NOW)).toEqual({
      type: "GiveSticker",
      key: "slack:sticker:T0PROPI001:U0GIVER001:1000.2000.synthetic2",
      workspaceId: WS,
      actor: ana,
      at: NOW,
      messageRef: "T0PROPI001:C0GENERAL1:sticker:1000.2000.synthetic2",
      stickerId: "st-thanks",
      channel: { id: "C0GENERAL1", kind: "public" },
      mentions: [{ kind: "member", memberId: "ana" }],
      channelMembers: ["ana", "bob", "giver"],
    });
  });
});

describe("buttons", () => {
  test("S48: Redeem → Redeem for the presser, keyed by Slack's action_ts so retries replay", () => {
    expect(actionCommand(fixture<SlackBlockAction>("block_actions.redeem.json"), WS, ana, NOW)).toEqual({
      type: "Redeem",
      key: "slack:redeem:T0PROPI001:U0ANA00001:1764083600.001100",
      workspaceId: WS,
      actor: ana,
      at: NOW,
      memberId: "ana",
      rewardId: "reward-mug",
      variantId: null,
    });
  });

  test("S2: the quantity picker → one Redeem with that quantity, keyed like the button", () => {
    const p = fixture<SlackBlockAction>("block_actions.redeem.json");
    const picked = { action_id: "propi_redeem_quantity", action_ts: "1764083600.001100", selected_option: { value: "reward-tee|size-m#3" } };
    expect(actionCommand({ ...p, actions: [picked] }, WS, ana, NOW)).toEqual({
      type: "Redeem",
      key: "slack:redeem:T0PROPI001:U0ANA00001:1764083600.001100",
      workspaceId: WS,
      actor: ana,
      at: NOW,
      memberId: "ana",
      rewardId: "reward-tee",
      variantId: "size-m",
      quantity: 3,
    });
  });

  test("S48: a variant button carries <reward>|<variant>", () => {
    const p = fixture<SlackBlockAction>("block_actions.redeem.json");
    const cmd = actionCommand({ ...p, actions: [{ ...p.actions[0]!, value: "reward-tee|size-m" }] }, WS, ana, NOW);
    expect(cmd).toMatchObject({ rewardId: "reward-tee", variantId: "size-m" });
  });

  test("S6: Approve → TransitionRedemption approve; core checks the role", () => {
    expect(actionCommand(fixture<SlackBlockAction>("block_actions.approve.json"), WS, boss, NOW)).toEqual({
      type: "TransitionRedemption",
      key: "slack:review:T0PROPI001:U0BOSS0001:redemption:redemption-1:approve",
      workspaceId: WS,
      actor: boss,
      at: NOW,
      redemptionId: "redemption-1",
      transition: "approve",
      reason: null,
    });
  });

  test("S6 S64: submission buttons → ReviewSubmission", () => {
    const p = fixture<SlackBlockAction>("block_actions.approve.json");
    const cmd = actionCommand({ ...p, actions: [{ ...p.actions[0]!, action_id: "propi_submission_reject", value: "sub-1" }] }, WS, boss, NOW);
    expect(cmd).toMatchObject({ type: "ReviewSubmission", submissionId: "sub-1", verdict: "reject", amount: null });
  });

  test("unknown actions produce no command", () => {
    const p = fixture<SlackBlockAction>("block_actions.approve.json");
    expect(actionCommand({ ...p, actions: [{ ...p.actions[0]!, action_id: "propi_open_shop" }] }, WS, boss, NOW)).toBeNull();
  });
});
