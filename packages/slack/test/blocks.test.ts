// Block Kit rendering (S1, S13, S28, S29, S48, S54, S83, S86): pure data → Slack JSON.
import { describe, expect, test } from "vitest";
import type { MemberId, PosInt, Reward } from "@propi/app";
import { errorText, homeView, notificationMessage, redemptionApprovalMessage, shopBlocks, type RenderContext } from "../src/index.ts";
import { settings } from "./lookup.ts";

const ctx: RenderContext = { currency: settings().currency, who: (m) => (m === "ana" ? "<@U0ANA00001>" : "a teammate"), appUrl: "https://propi.example" };
const m = (s: string) => s as MemberId;
const reward = (over: Partial<Reward> = {}): Reward => ({
  id: "reward-mug",
  title: "Mug",
  description: "A <b> mug",
  image: null,
  cost: 3 as PosInt,
  stock: 2,
  variants: [],
  categories: [],
  internalCost: null,
  instructions: "",
  status: "active",
  autoApprove: null,
  giftCard: false,
  createdAt: 0 as never,
  ...over,
});

describe("notifications", () => {
  test("S29: the giver's confirmation carries the remaining allowance in the workspace currency (S1)", () => {
    expect(notificationMessage({ type: "gift_confirmation", to: m("giver"), giftId: "g1" as never, totalCost: 4, remainingAllowance: 1 }, ctx).text).toBe(
      "You gave :taco: 4 tacos. You have 1 taco left to give today.",
    );
    const pesos: RenderContext = { ...ctx, currency: { primaryEmoji: ":star:", singular: "star", plural: "stars", extraEmojis: new Map() } };
    expect(notificationMessage({ type: "gift_confirmation", to: m("giver"), giftId: "g1" as never, totalCost: 1, remainingAllowance: 0 }, pesos).text).toBe(
      "You gave :star: 1 star. You have 0 stars left to give today.",
    );
  });

  test("S13: over allowance explains cost, what is left and how to fix it", () => {
    expect(errorText({ code: "over_allowance", cost: 6, remaining: 2 }, ctx)).toBe(
      "That would cost 6 tacos, but you have 2 tacos left to give today. Mention fewer people or use fewer tacos; your allowance resets at midnight.",
    );
  });

  test("S83: the receiver's DM names the giver and quotes the escaped message", () => {
    const n = notificationMessage({ type: "gift_received", to: m("bob"), giftId: "g1" as never, giver: m("ana"), amount: 2, channelId: "C1", text: "a <b> & c" }, ctx);
    expect(n.text).toBe("<@U0ANA00001> gave you :taco: 2 tacos in <#C1>.");
    expect(n.blocks[1]).toEqual({ type: "context", elements: [{ type: "mrkdwn", text: "> a &lt;b&gt; &amp; c" }] });
  });

  test("S86: the nudge counts unused allowance", () => {
    expect(notificationMessage({ type: "nudge", to: m("bob"), week: "2026-W48", unused: 7 }, ctx).text).toMatch(/^You still have 7 tacos to give this week\./);
  });
});

describe("shop and App Home", () => {
  test("S48: an affordable reward has a Redeem button with a confirm dialog", () => {
    const blocks = shopBlocks([reward()], 5, ctx);
    expect(blocks[1]).toMatchObject({ type: "actions", elements: [{ type: "button", action_id: "propi_redeem", value: "reward-mug", confirm: { type: "confirm" } }] });
    expect(JSON.stringify(blocks[0])).toContain("A &lt;b&gt; mug");
  });

  test("S46 S50: unaffordable or out-of-stock rewards show why instead of a button", () => {
    expect(shopBlocks([reward()], 1, ctx)[1]).toEqual({ type: "context", elements: [{ type: "mrkdwn", text: "You need 2 tacos more" }] });
    expect(shopBlocks([reward({ stock: 0 })], 9, ctx)[1]).toEqual({ type: "context", elements: [{ type: "mrkdwn", text: "Out of stock" }] });
    expect(shopBlocks([reward({ status: "draft" })], 9, ctx)).toEqual([{ type: "section", text: { type: "mrkdwn", text: "The shop is empty for now." } }]);
  });

  test("S48: variants get one button each", () => {
    const blocks = shopBlocks([reward({ variants: [{ id: "s", name: "S", stock: 1 }, { id: "l", name: "L", stock: 0 }] })], 9, ctx);
    expect((blocks[1] as unknown as { elements: { value: string }[] }).elements.map((e) => e.value)).toEqual(["reward-mug|s"]);
  });

  test("S28 S81: the home shows balance and allowance; a hidden leaderboard is left out", () => {
    const view = homeView(
      { balances: { received: 4, given: 1, redeemable: 3 }, allowance: { day: "2026-11-25" as never, limit: 5, used: 1, remaining: 4 }, leaderboard: null, rewards: [], level: null },
      ctx,
    );
    expect(view.type).toBe("home");
    const json = JSON.stringify(view.blocks);
    expect(json).toContain("*You can spend*\\n:taco: 3");
    expect(json).toContain("*Left to give today*\\n4 of 5");
    expect(json).not.toContain("Leaderboard");
  });

  test("S80: the App Home shows this month's and all-time leaderboards with medals", () => {
    const row = (id: string, rank: number, score: number) => ({ memberId: m(id), rank, score }) as never;
    const view = homeView(
      {
        balances: { received: 4, given: 1, redeemable: 3 },
        allowance: { day: "2026-11-25" as never, limit: 5, used: 1, remaining: 4 },
        leaderboard: { month: [row("ana", 1, 12)], allTime: [row("ana", 1, 1111), row("bo", 2, 811)] },
        rewards: [],
        level: null,
      },
      ctx,
    );
    const json = JSON.stringify(view.blocks);
    expect(json).toContain("*This month*\\n:first_place_medal: <@U0ANA00001> · *12*");
    expect(json).toContain("*All time*\\n:first_place_medal: <@U0ANA00001> · *1,111*\\n:second_place_medal: a teammate · *811*");
  });

  test("S6: an approval request has Approve and Reject buttons bound to the redemption", () => {
    const msg = redemptionApprovalMessage({ redemptionId: "r-1", member: m("ana"), rewardTitle: "Mug", cost: 3 }, ctx);
    expect(msg.text).toBe("<@U0ANA00001> redeemed *Mug* for :taco: 3 tacos.");
    expect(msg.blocks[1]).toMatchObject({ type: "actions", elements: [{ action_id: "propi_redemption_approve", value: "r-1" }, { action_id: "propi_redemption_reject", value: "r-1" }] });
  });
});
