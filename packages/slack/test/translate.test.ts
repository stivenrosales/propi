// Slack event payloads (recorded shapes, synthetic ids) → app commands (S9-S24, S42, G8, §1.7).
import { describe, expect, test } from "vitest";
import { emojiToken, parseSlackText, translateEvent, type SlackEnvelope } from "../src/index.ts";
import { WS, fakeLookup, fixture, settings } from "./lookup.ts";

const ORIGINAL = { "C0GENERAL1:1764082800.000100": { user: "U0GIVER001", botId: null, text: "<@U0ANA00001> <@U0DIANA001> gracias :taco::taco:" } };
const run = (name: string, lookup = fakeLookup({ messages: ORIGINAL })) => translateEvent(lookup, fixture<SlackEnvelope>(name));

describe("text parsing", () => {
  test("S9 S15: mentions, emojis in order, hashtags; channel links and skin tones are not tags or emojis", () => {
    expect(parseSlackText("<@U0ANA00001|ana> <!subteam^S0DESIGN01|@design> :taco::taco: :+1::skin-tone-3: <#C0GENERAL1|general> #fun (#ownership)")).toEqual({
      userIds: ["U0ANA00001"],
      groupIds: ["S0DESIGN01"],
      emojis: [":taco:", ":taco:", ":+1:"],
      hashtags: ["#fun", "#ownership"],
    });
  });
  test("reaction names become shortcode tokens", () => {
    expect(emojiToken("taco")).toBe(":taco:");
    expect(emojiToken("muscle::skin-tone-2")).toBe(":muscle:");
  });
});

describe("messages", () => {
  test("S9 S10 S15 S17: a channel gift → GiveByMessage keyed slack:msg:<team>:<channel>:<ts>", async () => {
    const t = await run("message.channels.gift.json");
    expect(t).toEqual({
      kind: "command",
      workspaceId: WS,
      command: {
        type: "GiveByMessage",
        key: "slack:msg:T0PROPI001:C0GENERAL1:1764082800.000100",
        workspaceId: WS,
        actor: { kind: "member", memberId: "giver", role: "member" },
        at: 1764082800000,
        messageRef: "T0PROPI001:C0GENERAL1:1764082800.000100",
        message: {
          channel: { id: "C0GENERAL1", kind: "public" },
          text: "<@U0ANA00001> <@U0DIANA001> gracias por la revisión :taco::taco: #ownership",
          mentions: [
            { kind: "member", memberId: "ana" },
            { kind: "member", memberId: "diana" },
          ],
          emojiTokens: [":taco:", ":taco:"],
          hashtags: ["#ownership"],
        },
      },
    });
  });

  test("S16: channel kinds come from channel_type (private group, DM)", async () => {
    const g = await run("message.groups.gift.json");
    const d = await run("message.im.gift.json");
    expect(g.kind === "command" && g.command.type === "GiveByMessage" && g.command.message.channel.kind).toBe("private");
    expect(d.kind === "command" && d.command.type === "GiveByMessage" && d.command.message.channel.kind).toBe("dm");
  });

  test("S12: user groups are expanded through the Directory call at gift time", async () => {
    const lookup = fakeLookup();
    const t = await run("message.usergroup.json", lookup);
    expect(lookup.calls).toContain("group:S0DESIGN01");
    expect(t.kind === "command" && t.command.type === "GiveByMessage" && t.command.message.mentions).toEqual([{ kind: "group", groupId: "S0DESIGN01", memberIds: ["ana", "bob", "giver"] }]);
    expect(t.kind === "command" && t.command.type === "GiveByMessage" && t.command.message.emojiTokens).toEqual([":taco:", ":fire:"]);
  });

  test("S8: a bot message gives as a bot actor", async () => {
    const t = await run("message.bot.json");
    expect(t.kind === "command" && t.command.actor).toEqual({ kind: "bot", platformUserId: "B0DEPLOY01" });
  });

  test("messages without any emoji and system subtypes produce no command", async () => {
    expect(await run("message.no_emoji.json")).toEqual({ kind: "ignored", reason: "no_emoji" });
    expect(await run("message.channel_join.json")).toEqual({ kind: "ignored", reason: "subtype_channel_join" });
  });

  test("S23: message_changed with an edit → EditMessage keyed slack:edit:…:<edit_ts>; unfurls are not edits", async () => {
    const t = await run("message.changed.json");
    expect(t.kind === "command" && t.command).toMatchObject({
      type: "EditMessage",
      key: "slack:edit:T0PROPI001:C0GENERAL1:1764082800.000100:1764082900.000000",
      messageRef: "T0PROPI001:C0GENERAL1:1764082800.000100",
      actor: { kind: "member", memberId: "giver" },
      message: { emojiTokens: [":taco:", ":taco:", ":taco:"] },
    });
    expect(await run("message.unfurl.json")).toEqual({ kind: "ignored", reason: "not_an_edit" });
  });

  test("S24: message_deleted → DeleteMessage keyed slack:del:… by the original author", async () => {
    const t = await run("message.deleted.json");
    expect(t.kind === "command" && t.command).toMatchObject({
      type: "DeleteMessage",
      key: "slack:del:T0PROPI001:C0GENERAL1:1764082800.000100",
      messageRef: "T0PROPI001:C0GENERAL1:1764082800.000100",
      actor: { kind: "member", memberId: "giver" },
    });
  });

  test("an unknown team is ignored", async () => {
    const body = { ...fixture<SlackEnvelope>("message.channels.gift.json"), team_id: "T0UNKNOWN1" };
    expect(await translateEvent(fakeLookup(), body)).toEqual({ kind: "ignored", reason: "unknown_workspace" });
  });
});

describe("reactions", () => {
  test("S18 S20: reaction_added with a gift emoji → GiveByReaction to the message's mentions, author kept", async () => {
    const lookup = fakeLookup({ messages: ORIGINAL });
    const t = await run("reaction.added.json", lookup);
    expect(lookup.calls).toContain("message:C0GENERAL1:1764082800.000100");
    expect(t.kind === "command" && t.command).toEqual({
      type: "GiveByReaction",
      key: "slack:react:T0PROPI001:C0GENERAL1:1764082800.000100:U0BOB00001:taco",
      workspaceId: WS,
      actor: { kind: "member", memberId: "bob", role: "member" },
      at: 1764083000001,
      messageRef: "T0PROPI001:C0GENERAL1:1764082800.000100",
      emoji: ":taco:",
      channel: { id: "C0GENERAL1", kind: "public" },
      target: { author: "giver", mentions: [{ kind: "member", memberId: "ana" }, { kind: "member", memberId: "diana" }] },
    });
  });

  test("S21: reaction_removed → RemoveReaction keyed slack:unreact:…", async () => {
    const t = await run("reaction.removed.json");
    expect(t.kind === "command" && t.command).toMatchObject({ type: "RemoveReaction", key: "slack:unreact:T0PROPI001:C0GENERAL1:1764082800.000100:U0BOB00001:taco", emoji: ":taco:" });
  });

  test("S42: a value emoji reaction tags the gift; other emojis are ignored without lookups", async () => {
    const t = await run("reaction.value.json");
    expect(t.kind === "command" && t.command).toMatchObject({ type: "TagGiftByReaction", emoji: ":muscle:", messageRef: "T0PROPI001:C0GENERAL1:1764082800.000100" });
    const lookup = fakeLookup();
    expect(await run("reaction.other.json", lookup)).toEqual({ kind: "ignored", reason: "not_a_gift_emoji" });
    expect(lookup.calls).toEqual([]);
  });

  test("S18: with reactions disabled no reaction gift is built", async () => {
    const t = await run("reaction.added.json", fakeLookup({ settings: settings({ reactionsEnabled: false }), messages: ORIGINAL }));
    expect(t).toEqual({ kind: "ignored", reason: "reactions_disabled" });
  });
});
