// End to end on real Postgres: recorded Slack payloads → createApp(execute) → ledger → outbox →
// relay → Slack DM payloads (S5, S9-S13, S17-S21, S28, S29, S48, S54, S6, S72, S83, G7).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { asShop, type CommandKey, type CreateReward, type Instant, type MemberId, type WorkspaceId } from "@propi/app";
import { createSecretCipher } from "@propi/db";
import type { SlackBlockAction, SlackEnvelope, SlackSlashCommand } from "@propi/slack";
import { handleAction, handleEvent, handleSlash, type InboundDeps } from "../src/inbound.ts";
import { adoptEnvToken } from "../src/install.ts";
import { createSlackLookup, provisionedMemberId } from "../src/lookup.ts";
import { relayOnce } from "../src/relay.ts";
import { createRuntime, type Runtime } from "../src/runtime.ts";
import { fakeSlack, fixture, gatewayOf, installTeam, tokenOf } from "./fakes.ts";
import { createTestDatabase, hasDatabase } from "./pg.ts";

const TEAM = "T0PROPI001";
/** 10:00 in America/Lima on 2026-11-25. */
const T0 = Date.UTC(2026, 10, 25, 15, 0, 0);
const ORIGINAL = { "C0GENERAL1:1764082800.000100": { user: "U0GIVER001", botId: null, text: "<@U0ANA00001> <@U0DIANA001> gracias :taco::taco:" } };

let db: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
let rt: Runtime;
let ws: WorkspaceId;
let now = T0;
const slack = fakeSlack({ messages: ORIGINAL, bots: ["U0BOTUSER1"] });
let d: InboundDeps;
const logs: string[] = [];

type Mutable = { event: Record<string, unknown> };
const env = (name: string, mutate: (e: Mutable) => void = () => undefined): SlackEnvelope => {
  const e = fixture<SlackEnvelope & Mutable>(name);
  mutate(e);
  return e;
};
const member = (user: string) => provisionedMemberId(ws, TEAM, user);
const relay = () => relayOnce({ ...d, appUrl: null });

beforeAll(async () => {
  if (!hasDatabase) return;
  db = await createTestDatabase();
  let n = 0;
  rt = createRuntime(db.client, {
    cipher: createSecretCipher("00".repeat(32)),
    clock: { now: () => now as Instant },
    ids: { next: (kind) => `${kind}-${++n}` },
  });
  const gateway = gatewayOf(rt, { [TEAM]: slack.api });
  d = { rt, lookup: createSlackLookup(rt, gateway), slack: gateway, appUrl: "https://propi.example", log: (m) => void logs.push(m) };
  ws = await installTeam(rt, { team: TEAM, installer: "U0BOSS0001", now: T0 });
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

describe.skipIf(!hasDatabase)("server on Postgres", () => {
  test("S5: the first start makes the installer the first admin; a restart changes nothing", async () => {
    const admins = (await rt.ports.directory.members(ws)).filter((r) => r.role === "admin");
    expect(admins).toHaveLength(1);
    const again = await adoptEnvToken(rt, { teamId: TEAM, botToken: "xoxb-other", botUserId: "U0PROPIBOT", installerUserId: "U0OTHER001", timezone: "UTC", now: T0 as Instant });
    expect(again).toEqual({ workspaceId: ws, outcome: "kept" });
    expect((await rt.installations.find("slack", TEAM))?.installation).toMatchObject({ botToken: tokenOf(TEAM) });
    expect((await rt.ports.directory.members(ws)).filter((r) => r.role === "admin")).toHaveLength(1);
  });

  test("S9 S10 S29 S83: a channel gift → ledger → outbox → giver confirmation and receiver DMs", async () => {
    const out = await handleEvent(d, env("message.channels.gift.json"));
    expect(out.result).toMatchObject({ ok: true, replayed: false, value: { perReceiver: 2, totalCost: 4, remainingAllowance: 1 } });
    expect(await rt.app.balances(ws, member("U0ANA00001"))).toMatchObject({ received: 2, redeemable: 2 });
    expect(await rt.app.balances(ws, member("U0GIVER001"))).toMatchObject({ given: 4 });

    const pass = await relay();
    expect(pass.slackEvents).toBe(1);
    const posted = slack.take();
    expect(posted.map((p) => [p.channel, p.text])).toEqual([
      ["DM:U0GIVER001", "You gave :taco: 4 tacos. You have 1 taco left to give today."],
      ["DM:U0ANA00001", "<@U0GIVER001> gave you :taco: 2 tacos in <#C0GENERAL1>."],
      ["DM:U0DIANA001", "<@U0GIVER001> gave you :taco: 2 tacos in <#C0GENERAL1>."],
    ]);
    expect(posted[1]!.blocks).toContainEqual({ type: "context", elements: [{ type: "mrkdwn", text: "> &lt;@U0ANA00001&gt; &lt;@U0DIANA001&gt; gracias por la revisión :taco::taco: #ownership" }] });
  });

  test("S17 G7: the same Slack event twice writes once, replays the result and sends nothing new", async () => {
    const out = await handleEvent(d, env("message.channels.gift.json"));
    expect(out.result).toMatchObject({ ok: true, replayed: true });
    expect(await rt.app.balances(ws, member("U0ANA00001"))).toMatchObject({ received: 2 });
    expect((await relay()).slackEvents).toBe(0);
    expect(slack.take()).toEqual([]);
  });

  test("S13: over allowance moves nothing and DMs the giver a private notice once", async () => {
    const over = env("message.channels.gift.json", (e) => {
      e.event["ts"] = "1764082999.000900";
      e.event["text"] = "<@U0ANA00001> :taco::taco:";
    });
    const out = await handleEvent(d, over);
    expect(out.result).toMatchObject({ ok: false, error: { code: "over_allowance", cost: 2, remaining: 1 } });
    await handleEvent(d, over);
    await relay();
    expect(slack.take()).toEqual([
      expect.objectContaining({ channel: "DM:U0GIVER001", text: expect.stringMatching(/^Nothing was given\. That would cost 2 tacos, but you have 1 taco left to give today\./) }),
    ]);
    expect(await rt.app.balances(ws, member("U0ANA00001"))).toMatchObject({ received: 2 });
  });

  test("S8 S9: bot messages and messages without a gift are silent no-ops", async () => {
    const logged = logs.length;
    const bot = await handleEvent(d, env("message.bot.json"));
    expect(bot.result).toMatchObject({ ok: false, error: { code: "bots_may_not_give" } });
    expect(await handleEvent(d, env("message.no_emoji.json"))).toEqual({ handled: "ignored", reason: "no_emoji" });
    const self = await handleEvent(d, env("message.channels.gift.json", (e) => {
      e.event["ts"] = "1764082998.000800";
      e.event["text"] = "<@U0GIVER001> :taco:";
    }));
    expect(self.result).toMatchObject({ ok: false, error: { code: "not_a_gift" } });
    expect(logs.slice(logged)).toEqual(["event refused"]); // only the bot refusal is logged
    await relay();
    expect(slack.take()).toEqual([]);
  });

  test("S18 S19 S21: a reaction gives to the reacted message's mentions; removing it the same day reverses", async () => {
    const add = await handleEvent(d, env("reaction.added.json"));
    expect(add.result).toMatchObject({ ok: true, value: { receivers: [member("U0ANA00001"), member("U0DIANA001")], perReceiver: 1 } });
    expect(await rt.app.allowance(ws, member("U0BOB00001"))).toMatchObject({ remaining: 3 });
    const remove = await handleEvent(d, env("reaction.removed.json"));
    expect(remove.result).toMatchObject({ ok: true, value: { reversed: 2, allowanceRestored: 2 } });
    expect(await rt.app.allowance(ws, member("U0BOB00001"))).toMatchObject({ remaining: 5 });
    await relay();
    slack.take();
  });

  test("S28 S48: the App Home shows balance, allowance, leaderboard and the shop; /propi balance answers privately", async () => {
    await handleEvent(d, env("app_home_opened.json"));
    expect(slack.homes).toHaveLength(1);
    // The real balances and both leaderboards (layout of 8214fcf: stat fields, monthly and all-time boards).
    const texts = (slack.homes[0]!.blocks as { text?: { text?: string }; fields?: { text: string }[]; elements?: { text?: string }[] }[]).flatMap((b) => [
      ...(b.text?.text === undefined ? [] : [b.text.text]),
      ...(b.fields ?? []).map((f) => f.text),
      ...(b.elements ?? []).flatMap((e) => (e.text === undefined ? [] : [e.text])),
    ]);
    expect(texts).toContain("*Received*\n:taco: 2");
    expect(texts).toContain("*You can spend*\n:taco: 2");
    expect(texts).toContain("*Left to give today*\n5 of 5");
    expect(texts.find((t) => t.startsWith("*This month*\n"))).toContain(":first_place_medal: <@U0ANA00001> · *2*");
    expect(texts.find((t) => t.startsWith("*All time*\n"))).toContain(":first_place_medal: <@U0ANA00001> · *2*");
    expect(texts).toContain("The shop is empty for now.");
    const reply = await handleSlash(d, fixture<SlackSlashCommand>("slash.balance.json"));
    expect(reply.text).toBe("You can spend 2 tacos and give 5 tacos more today.");
  });

  test("S48 S50 S6 S54: redeem from Slack → approvers get buttons → approve → the member is told", async () => {
    const bossMember = (await rt.ports.directory.members(ws)).find((r) => r.role === "admin")!.id;
    const create: CreateReward = {
      type: "CreateReward",
      key: "test:reward:mug" as CommandKey,
      workspaceId: ws,
      actor: { kind: "member", memberId: bossMember, role: "admin" },
      at: now as Instant,
      reward: { title: "Propi mug", description: "", image: null, cost: 2, stock: 3, variants: [], categories: [], internalCost: null, instructions: "", autoApprove: false, giftCard: false },
    };
    const created = await rt.app.execute(create);
    if (!created.ok) throw new Error(created.error.code);
    await rt.app.execute({ type: "SetRewardStatus", key: "test:reward:mug:on" as CommandKey, workspaceId: ws, actor: create.actor, at: now as Instant, rewardId: created.value.rewardId, status: "active" });

    const press = fixture<SlackBlockAction>("block_actions.redeem.json");
    const redeem = { ...press, actions: [{ ...press.actions[0]!, value: created.value.rewardId }] };
    const r = await handleAction(d, redeem);
    expect(r).toMatchObject({ ok: true, refreshHome: true });
    expect(await rt.app.balances(ws, member("U0ANA00001"))).toMatchObject({ redeemable: 0 });
    // A Slack retry of the same press replays: no second redemption.
    expect((await handleAction(d, redeem))?.ok).toBe(true);
    expect(await asShop(rt.ports.reader.workspace(ws)).redemptions()).toHaveLength(1);

    await relay();
    const first = slack.take();
    expect(first.map((p) => p.channel)).toEqual(["DM:U0ANA00001", "DM:U0BOSS0001"]);
    expect(first[0]!.text).toBe("You redeemed *Propi mug* for :taco: 2 tacos. We'll let you know when it's approved.");
    const approval = first[1]!;
    const buttons = (approval.blocks.find((b) => (b as { type: string }).type === "actions") as { elements: { action_id: string; value: string }[] }).elements;
    expect(buttons.map((b) => b.action_id)).toEqual(["propi_redemption_approve", "propi_redemption_reject"]);

    const approve = fixture<SlackBlockAction>("block_actions.approve.json");
    const pressed = { ...approve, actions: [{ ...approve.actions[0]!, value: buttons[0]!.value }] };
    expect(await handleAction(d, pressed)).toMatchObject({ ok: true, text: "Done: the redemption is now approved." });
    // A member without the approver role cannot approve (S6): core refuses.
    const notAllowed = await handleAction(d, { ...pressed, user: { id: "U0GIVER001", team_id: TEAM } });
    expect(notAllowed).toMatchObject({ ok: false });
    await relay();
    expect(slack.take().map((p) => [p.channel, p.text])).toEqual([["DM:U0ANA00001", "Your redemption of *Propi mug* was approved."]]);
  });

  test("S72: app_uninstalled keeps the data and stops serving the workspace", async () => {
    const before = await rt.ports.reader.workspace(ws).entries();
    expect(await handleEvent(d, env("app_uninstalled.json"))).toEqual({ handled: "lifecycle", type: "app_uninstalled" });
    expect((await rt.installations.find("slack", TEAM))?.uninstalledAt).not.toBeNull();
    expect(await handleEvent(d, env("message.channels.gift.json"))).toEqual({ handled: "ignored", reason: "unknown_workspace" });
    expect(await rt.ports.reader.workspace(ws).entries()).toHaveLength(before.length);
  });
});
