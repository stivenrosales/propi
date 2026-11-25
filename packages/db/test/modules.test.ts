// Port contract for module state: the shop store (compare-and-set writes, S44-S59, S108), the
// engagement stores (S60-S79, S92-S96) and identities (S107). The same scenarios run through
// createApp() against the in-memory fakes and against real Postgres, and must read back the same.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  accept,
  createApp,
  defaultSettings,
  engagementHandlers,
  type Actor,
  type App,
  type CommandBase,
  type CommandKey,
  type IdentityStore,
  type Instant,
  type LedgerEntry,
  type PosInt,
  type Ports,
  type Result,
  type ShopReader,
  type StateWrite,
  type WorkspaceId,
} from "@propi/app";
import { createEngagementMemory, createGiftCardFake, createMemoryIdentityStore, createMemoryPorts, type EngagementDeps } from "@propi/app/testing";
import { createDbAdmin, createDbEngagementStores, createDbIdentityStore, createDbInspector, createDbPorts, type PrismaClient } from "../src/index.ts";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./pg.ts";
import { T0, admin, key, m, memberActor } from "./harness.ts";

let db: TestDatabase | undefined;
let pg: PrismaClient | undefined;

beforeAll(async () => {
  if (hasDatabase) {
    db = await createTestDatabase();
    pg = db.client();
  }
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

type Stores = Omit<EngagementDeps, "reader" | "directory">;

interface ModuleHarness {
  readonly ws: WorkspaceId;
  readonly app: App;
  readonly ports: Ports;
  readonly stores: Stores;
  readonly identities: IdentityStore;
  run<T = unknown>(cmd: CommandBase & { readonly type: string } & Readonly<Record<string, unknown>>): Promise<Result<T>>;
  shop(): ShopReader;
  entries(): Promise<readonly LedgerEntry[]>;
  commandLog(): Promise<readonly unknown[]>;
}

type Backend = (opts?: { prepaid?: number }) => Promise<ModuleHarness>;

const PEOPLE = ["ana", "bob", "diana", "lind", "giver"];
let wsCounter = 0;

const memoryBackend: Backend = async (opts = {}) => {
  const giftCards = opts.prepaid === undefined ? null : createGiftCardFake({ minor: opts.prepaid, currency: "PEN" });
  const mem = createMemoryPorts({ now: T0, giftCards });
  const ws = `ws-mod-mem-${++wsCounter}` as WorkspaceId;
  mem.addWorkspace(ws, defaultSettings({ timezone: "America/Lima" }));
  for (const id of PEOPLE) mem.addMember(ws, { id: m(id), role: "member", active: true, dailyLimitOverride: null });
  mem.addMember(ws, { id: m("boss"), role: "admin", active: true, dailyLimitOverride: null });
  mem.addMember(ws, { id: m("rita"), role: "approver", active: true, dailyLimitOverride: null });
  const eng = createEngagementMemory(mem);
  const app = createApp(eng.ports, { handlers: eng.handlers });
  const { reader: _r, directory: _d, ...stores } = eng.deps;
  return {
    ws,
    app,
    ports: eng.ports,
    stores,
    identities: createMemoryIdentityStore(),
    run: (cmd) => app.executeAny(cmd) as never,
    shop: () => eng.ports.reader.workspace(ws) as unknown as ShopReader,
    entries: async () => mem.entries(ws),
    commandLog: async () => mem.commandLog(ws),
  };
};

const postgresBackend: Backend = async (opts = {}) => {
  if (pg === undefined) throw new Error("no database");
  const giftCards = opts.prepaid === undefined ? null : createGiftCardFake({ minor: opts.prepaid, currency: "PEN" });
  const ws = `ws-mod-pg-${process.pid}-${++wsCounter}` as WorkspaceId;
  let n = 0;
  const ports = createDbPorts(pg, { clock: { now: () => T0 }, ids: { next: (kind) => `${kind}-${++n}` }, giftCards });
  const dbAdmin = createDbAdmin(pg);
  await dbAdmin.addWorkspace(ws, defaultSettings({ timezone: "America/Lima" }));
  for (const id of PEOPLE) await dbAdmin.addMember(ws, { id: m(id), role: "member", active: true, dailyLimitOverride: null });
  await dbAdmin.addMember(ws, { id: m("boss"), role: "admin", active: true, dailyLimitOverride: null });
  await dbAdmin.addMember(ws, { id: m("rita"), role: "approver", active: true, dailyLimitOverride: null });
  const stores = createDbEngagementStores(pg);
  const app = createApp(ports, { handlers: engagementHandlers({ reader: ports.reader, directory: ports.directory, ...stores }) });
  const inspect = createDbInspector(pg);
  return {
    ws,
    app,
    ports,
    stores,
    identities: createDbIdentityStore(pg),
    run: (cmd) => app.executeAny(cmd) as never,
    shop: () => ports.reader.workspace(ws) as unknown as ShopReader,
    entries: () => inspect.entries(ws),
    commandLog: () => inspect.commandLog(ws),
  };
};

const backends: [string, Backend, boolean][] = [
  ["memory", memoryBackend, false],
  ["postgres", postgresBackend, !hasDatabase],
];

/** Strip what legitimately differs between stores (seq, timestamps of rows); keep the domain shape. */
const shape = (entries: readonly LedgerEntry[]) => entries.map((e) => [e.kind, e.memberId, e.amount, e.cause, e.reason]);

describe.each(backends)("module state on %s", (_name, backend, skip) => {
  let h: ModuleHarness;
  let s = 0;
  const base = (k: string, actor: Actor = admin) => ({ key: key(k), workspaceId: h.ws, actor, at: T0 });
  const fund = (who: string, amount: number) =>
    h.app.execute({ type: "GrantBonus", ...base(`api:fund:${++s}`), memberIds: [m(who)], amount: amount as PosInt, reason: "fund" });
  const rewardInput = (over: Record<string, unknown> = {}) => ({
    title: "Hoodie",
    description: "Team hoodie",
    image: null,
    cost: 10,
    stock: null,
    variants: [],
    categories: ["merch"],
    internalCost: { minor: 3000, currency: "PEN" },
    instructions: "Pick it up at the office",
    autoApprove: null,
    giftCard: false,
    ...over,
  });

  test.skipIf(skip)("S44 S45 S46: a reward with variants is created, edited, published and restocked; stock and status read back", async () => {
    h = await backend();
    const variants = [
      { id: "s", name: "Small", stock: 1 },
      { id: "l", name: "Large", stock: null },
    ];
    const created = await h.run<{ rewardId: string }>({ type: "CreateReward", ...base("web:reward:1"), reward: rewardInput({ variants }) });
    expect(created).toEqual({ ok: true, replayed: false, value: { rewardId: "reward-1" } });
    expect(await h.run({ type: "UpdateReward", ...base("web:update:1"), rewardId: "reward-1", changes: { title: "Hoodie v2", cost: 11 } })).toMatchObject({ ok: true });
    expect(await h.run({ type: "SetRewardStatus", ...base("web:status:1"), rewardId: "reward-1", status: "active" })).toMatchObject({ ok: true, value: { status: "active" } });
    expect(await h.run({ type: "Restock", ...base("web:restock:1"), rewardId: "reward-1", variantId: "s", quantity: 2 as PosInt })).toMatchObject({
      ok: true,
      value: { rewardId: "reward-1", variantId: "s", stock: 3 },
    });
    const reward = await h.shop().reward("reward-1");
    expect(reward).toMatchObject({ id: "reward-1", title: "Hoodie v2", cost: 11, status: "active", stock: null, createdAt: T0, giftCard: false });
    expect(reward?.variants).toEqual([
      { id: "s", name: "Small", stock: 3 },
      { id: "l", name: "Large", stock: null },
    ]);
    expect((await h.shop().rewards()).map((r) => r.id)).toEqual(["reward-1"]);
    // S45: an archived reward cannot be edited.
    expect(await h.run({ type: "SetRewardStatus", ...base("web:status:2"), rewardId: "reward-1", status: "archived" })).toMatchObject({ ok: true });
    expect(await h.run({ type: "UpdateReward", ...base("web:update:2"), rewardId: "reward-1", changes: { title: "x" } })).toMatchObject({ ok: false });
    expect((await h.shop().reward("reward-1"))?.title).toBe("Hoodie v2");
  });

  test.skipIf(skip)("S49 S50 S51 S54: redeem a variant, approve, fulfil; a second redemption is rejected and refunded with its stock", async () => {
    h = await backend();
    await fund("ana", 30);
    const variants = [{ id: "s", name: "Small", stock: 2 }];
    await h.run({ type: "CreateReward", ...base("web:reward:1"), reward: rewardInput({ variants }) });
    await h.run({ type: "SetRewardStatus", ...base("web:status:1"), rewardId: "reward-1", status: "active" });
    const redeem = (k: string) => h.run<{ redemptionId: string; state: string; redeemable: number }>({ type: "Redeem", ...base(k, memberActor("ana")), memberId: m("ana"), rewardId: "reward-1", variantId: "s" });
    const r1 = await redeem("web:redeem:1");
    const r2 = await redeem("web:redeem:2");
    expect(r1).toMatchObject({ ok: true, value: { state: "pending", redeemable: 20 } });
    expect(r2).toMatchObject({ ok: true, value: { state: "pending", redeemable: 10 } });
    if (!r1.ok || !r2.ok) throw new Error();
    expect((await h.shop().reward("reward-1"))?.variants[0]?.stock).toBe(0);
    expect(await redeem("web:redeem:3")).toMatchObject({ ok: false, error: { code: "out_of_stock" } });

    const t = (id: string, transition: string, k: string) => h.run({ type: "TransitionRedemption", ...base(k), redemptionId: id, transition, reason: transition === "reject" ? "no" : null });
    expect(await t(r1.value.redemptionId, "approve", "t1")).toMatchObject({ ok: true, value: { state: "approved", changed: true } });
    expect(await t(r1.value.redemptionId, "fulfil", "t2")).toMatchObject({ ok: true, value: { state: "fulfilled", changed: true } });
    expect(await t(r1.value.redemptionId, "fulfil", "t3")).toMatchObject({ ok: true, value: { state: "fulfilled", changed: false } }); // S53
    expect(await t(r2.value.redemptionId, "reject", "t4")).toMatchObject({ ok: true, value: { state: "rejected", refunded: 10 } });
    expect(await t(r2.value.redemptionId, "approve", "t5")).toMatchObject({ ok: false, error: { code: "illegal_transition" } });

    expect((await h.shop().redemptions()).map((r) => [r.id, r.state, r.variantId])).toEqual([
      [r1.value.redemptionId, "fulfilled", "s"],
      [r2.value.redemptionId, "rejected", "s"],
    ]);
    expect((await h.shop().reward("reward-1"))?.variants[0]?.stock).toBe(1); // the rejected unit came back
    expect(shape(await h.entries()).filter(([kind]) => kind !== "bonus")).toEqual([
      ["spend", "ana", 10, { type: "redemption", redemptionId: r1.value.redemptionId }, "Hoodie"],
      ["spend", "ana", 10, { type: "redemption", redemptionId: r2.value.redemptionId }, "Hoodie"],
      ["refund", "ana", 10, { type: "redemption", redemptionId: r2.value.redemptionId }, "no"],
    ]);
    expect(await h.app.balances(h.ws, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 20 });
  });

  test.skipIf(skip)("S56 S57 S58: a collab collects contributions into one group redemption; another is archived and refunds everyone", async () => {
    h = await backend();
    for (const w of ["ana", "bob"]) await fund(w, 10);
    const c1 = await h.run<{ collabId: string }>({ type: "CreateCollab", ...base("web:collab:1"), title: "Dinner", description: "", goal: 8, deadline: null, autoApprove: false });
    const c2 = await h.run<{ collabId: string }>({ type: "CreateCollab", ...base("web:collab:2"), title: "Trip", description: "", goal: 50, deadline: null, autoApprove: false });
    if (!c1.ok || !c2.ok) throw new Error();
    const contribute = (who: string, id: string, amount: number, k: string) => h.run({ type: "Contribute", ...base(k, memberActor(who)), collabId: id, memberId: m(who), amount });
    expect(await contribute("ana", c1.value.collabId, 5, "c1")).toMatchObject({ ok: true, value: { taken: 5, raised: 5 } });
    expect(await contribute("bob", c1.value.collabId, 5, "c2")).toMatchObject({ ok: true, value: { taken: 3, raised: 8 } });
    expect(await contribute("ana", c2.value.collabId, 2, "c3")).toMatchObject({ ok: true });
    expect(await contribute("bob", c2.value.collabId, 1, "c4")).toMatchObject({ ok: true });

    expect((await h.shop().collab(c1.value.collabId))?.phase).toBe("completed");
    expect([...(await h.shop().contributions(c1.value.collabId))]).toEqual([
      ["ana", 5],
      ["bob", 3],
    ]);
    expect((await h.shop().redemptions()).filter((r) => r.collabId === c1.value.collabId)).toHaveLength(1);

    expect(await h.run({ type: "CloseCollab", ...base(`collab:${c2.value.collabId}:refund`), collabId: c2.value.collabId, why: "archived" })).toMatchObject({
      ok: true,
      value: { members: 2, refunded: 3 },
    });
    expect((await h.shop().collab(c2.value.collabId))?.phase).toBe("refunded");
    expect([...(await h.shop().contributions(c2.value.collabId))]).toEqual([
      ["ana", 0],
      ["bob", 0],
    ]);
    expect(await h.app.balances(h.ws, m("ana"))).toMatchObject({ redeemable: 5 });
    expect(await h.app.balances(h.ws, m("bob"))).toMatchObject({ redeemable: 7 });
    expect(await h.app.ledgerCheck(h.ws)).toMatchObject({ ok: true });
  });

  test.skipIf(skip)("S108: prepaidAvailable is the provider balance minus held, not-yet-issued gift-card redemptions", async () => {
    h = await backend({ prepaid: 10_000 });
    await fund("ana", 30);
    await h.run({ type: "ConfigureShop", ...base("web:cfg"), settings: { autoApprove: false, monthlyBudget: { minor: 100_000, currency: "PEN" } } });
    await h.run({ type: "CreateReward", ...base("web:reward:1"), reward: rewardInput({ giftCard: true, internalCost: { minor: 4000, currency: "PEN" } }) });
    await h.run({ type: "SetRewardStatus", ...base("web:status:1"), rewardId: "reward-1", status: "active" });
    expect(await h.shop().prepaidAvailable()).toEqual({ minor: 10_000, currency: "PEN" });
    expect(await h.run({ type: "Redeem", ...base("web:redeem:1", memberActor("ana")), memberId: m("ana"), rewardId: "reward-1", variantId: null })).toMatchObject({ ok: true });
    expect(await h.shop().prepaidAvailable()).toEqual({ minor: 6000, currency: "PEN" });
    expect(await h.shop().budgetSpent("2026-11")).toBe(4000);
  });

  test.skipIf(skip)("S49 S46: a failed compare-and-set rolls back the whole unit (claim, entries, writes)", async () => {
    h = await backend();
    await fund("ana", 5);
    const before = (await h.entries()).length;
    const logBefore = (await h.commandLog()).length;
    const commitWith = (k: string, writes: readonly ({ readonly t: string } & Readonly<Record<string, unknown>>)[]) =>
      h.ports.uow.run(h.ws, [], async (tx) => {
        await tx.claim(k as CommandKey, "h");
        await tx.commit({
          key: k as CommandKey,
          requestHash: "h",
          commandType: "Test",
          actor: admin,
          at: T0 as Instant,
          command: {},
          decision: {
            ...accept({}),
            entries: [{ kind: "bonus", amount: 1 as PosInt, memberId: m("ana"), counterpartId: null, cause: { type: "admin" }, source: null, allowanceDay: null, reason: "x" }],
            writes: writes as readonly StateWrite[],
          },
        });
      });
    const redemption = {
      id: "ghost", memberId: m("ana"), rewardId: null, variantId: null, collabId: null, cost: 1 as PosInt, internalCost: null, budgetMonth: null,
      stockReserved: false, giftCard: false, cardIssued: false, onBehalfOf: "self", state: "approved", createdAt: T0, updatedAt: T0, reason: null,
    };
    // S49: moving a redemption that is not in the expected state changes 0 rows -> the unit fails.
    await expect(commitWith("job:cas-1", [{ t: "shop.redemption.put", from: "pending", redemption }])).rejects.toThrow();
    // S46: taking stock of a reward that has none (or does not exist) fails the same way.
    await expect(commitWith("job:cas-2", [{ t: "shop.stock.take", rewardId: "nope", variantId: null }])).rejects.toThrow();
    expect(await h.entries()).toHaveLength(before);
    expect(await h.commandLog()).toHaveLength(logBefore);
    expect(await h.shop().redemption("ghost")).toBeNull();
  });

  test.skipIf(skip)("S60 S64 S66 S67: rules, quests, submissions and comments persist through the engagement stores", async () => {
    h = await backend();
    const rule = { id: "r1", name: "Top receiver", period: "month", criterion: { kind: "top_receivers", n: 1 }, reward: 20, announceChannel: null };
    expect(await h.run({ type: "DefineAwardRule", ...base("api:rule"), rule })).toEqual({ ok: true, replayed: false, value: { ruleId: "r1" } });
    expect(await h.stores.rules.rule(h.ws, "r1")).toEqual({ ...rule, ties: "all_win", active: true });
    expect((await h.stores.rules.rules(h.ws)).map((r) => r.id)).toEqual(["r1"]);

    const quest = {
      id: "q1", title: "Run a demo", description: "", image: null, reward: { mode: "fixed", amount: 5 }, submitters: "both", proofRequired: false,
      approvalRequired: true, timeline: true, perSubmitterCap: null, teamCap: null, cooldownMs: 0, opensAt: null, closesAt: null, trigger: null,
    };
    await h.run({ type: "DefineQuest", ...base("api:quest"), quest });
    await h.run({ type: "PublishQuest", ...base("api:publish"), questId: "q1" });
    expect(await h.run({ type: "SubmitQuest", ...base("web:s:1", memberActor("ana")), questId: "q1", memberId: m("ana"), proof: null, note: "done" })).toMatchObject({
      ok: true,
      value: { submissionId: "submission-1", state: "pending" },
    });
    expect(await h.run({ type: "ReviewSubmission", ...base("web:r:1"), submissionId: "submission-1", verdict: "approve", amount: null, note: null })).toMatchObject({
      ok: true,
      value: { state: "approved", reward: 5 },
    });
    expect((await h.stores.quests.quest(h.ws, "q1"))?.state).toBe("open");
    expect((await h.stores.quests.quests(h.ws)).map((q) => q.id)).toEqual(["q1"]);
    expect(await h.stores.quests.submission(h.ws, "submission-1")).toMatchObject({ questId: "q1", memberId: "ana", state: "approved", reward: 5, submittedAt: T0 });
    expect((await h.stores.quests.submissions(h.ws, "q1")).map((x) => x.id)).toEqual(["submission-1"]);
    expect(await h.app.balances(h.ws, m("ana"))).toEqual({ received: 0, given: 0, redeemable: 5 });
  });

  test.skipIf(skip)("S73 S75 S76: sticker config, definitions, grants and uses persist and count against the monthly quota", async () => {
    h = await backend();
    expect(await h.stores.stickers.config(h.ws)).toEqual({ enabled: false }); // S73: OFF by default
    await h.run({ type: "ConfigureStickers", ...base("api:stickers:on"), enabled: true });
    await h.run({ type: "DefineSticker", ...base("api:sticker"), sticker: { id: "truck", name: "Truck", image: null, receivers: 5, unitsPerReceiver: 2, monthlyQuota: 1 } });
    await h.run({ type: "GrantStickerUses", ...base("api:grant:1"), memberId: m("giver"), stickerId: "truck", uses: 2 });
    await h.run({ type: "GrantStickerUses", ...base("api:grant:2"), memberId: m("giver"), stickerId: "truck", uses: 1 });
    const give = (k: string) =>
      h.run({ type: "GiveSticker", ...base(k, memberActor("giver")), messageRef: `T:C1:${k}`, stickerId: "truck", channel: { id: "C1", kind: "public" }, mentions: [{ kind: "member", memberId: m("ana") }], channelMembers: [] });
    expect(await give("st:1")).toMatchObject({ ok: true });
    expect(await h.stores.stickers.config(h.ws)).toEqual({ enabled: true });
    expect(await h.stores.stickers.sticker(h.ws, "truck")).toMatchObject({ id: "truck", monthlyQuota: 1, active: true });
    expect(await h.stores.stickers.granted(h.ws, m("giver"), "truck", "2026-11")).toBe(3);
    expect(await h.stores.stickers.used(h.ws, m("giver"), "truck", "2026-11")).toBe(1);
    expect(await h.app.balances(h.ws, m("ana"))).toMatchObject({ received: 2 });
  });

  test.skipIf(skip)("S77 S78 S92 S95 S96: level config, avatars, milestone profiles, pairing opt-ins and rounds persist", async () => {
    h = await backend();
    const table = [
      { level: 1, title: "Sprout", min: 0 },
      { level: 2, title: "Helper", min: 3 },
    ];
    const avatars = [{ id: "cat", name: "Cat", image: null, minLevel: 1 }];
    await h.run({ type: "ConfigureLevels", ...base("api:levels"), table, avatars });
    expect(await h.run({ type: "ChooseAvatar", ...base("web:avatar", memberActor("ana")), avatarId: "cat" })).toMatchObject({ ok: true });
    expect(await h.stores.levels.config(h.ws)).toEqual({ table, avatars });
    expect(await h.stores.levels.avatar(h.ws, m("ana"))).toBe("cat");
    expect(await h.stores.levels.avatar(h.ws, m("bob"))).toBeNull();

    const profile = { birthday: { month: 11, day: 25 }, startDate: "2024-11-25", visibility: "public" };
    expect(await h.run({ type: "SetMilestones", ...base("web:ms", memberActor("ana")), memberId: m("ana"), ...profile })).toMatchObject({ ok: true });
    expect(await h.stores.milestones.profile(h.ws, m("ana"))).toEqual({ memberId: "ana", ...profile });
    expect((await h.stores.milestones.profiles(h.ws)).map((p) => p.memberId)).toEqual(["ana"]);

    const config = { enabled: true, cadence: "weekly", avoidRepeatsWithin: 2, prompts: ["Favourite tool?"] };
    await h.run({ type: "ConfigurePairing", ...base("api:pairing"), config });
    for (const id of ["lind", "ana", "bob", "diana"]) await h.run({ type: "SetPairingOptIn", ...base(`web:opt:${id}`, memberActor(id)), memberId: m(id), optedIn: true });
    await h.run({ type: "SetPairingOptIn", ...base("web:opt:diana:off", memberActor("diana")), memberId: m("diana"), optedIn: false });
    expect(await h.stores.pairing.config(h.ws)).toEqual(config);
    expect(await h.stores.pairing.optedIn(h.ws)).toEqual(["ana", "bob", "lind"]);
    const round = await h.run({ type: "RunPairingRound", ...base("job:pairing:2026-W48"), round: "2026-W48", seed: "s1" });
    expect(round).toMatchObject({ ok: true });
    const rounds = await h.stores.pairing.rounds(h.ws);
    expect(rounds.map((r) => r.round)).toEqual(["2026-W48"]);
    expect(rounds[0]?.groups.flat().sort()).toEqual(["ana", "bob", "lind"]);
  });

  test.skipIf(skip)("S107: identities are found by (platform, tenant, user), listed per workspace, and stay unique", async () => {
    h = await backend();
    const ana = { workspaceId: h.ws, platform: "slack", tenantId: "T1", userId: "U1", memberId: m("ana") } as const;
    await h.identities.insert(ana);
    await h.identities.insert({ ...ana, platform: "teams", tenantId: "tenant", userId: "aad-1" });
    expect(await h.identities.find(h.ws, { platform: "slack", tenantId: "T1", userId: "U1" })).toEqual(ana);
    expect(await h.identities.find(h.ws, { platform: "slack", tenantId: "T1", userId: "U2" })).toBeNull();
    expect((await h.identities.list(h.ws)).map((i) => i.memberId)).toEqual(["ana", "ana"]);
    await expect(h.identities.insert({ ...ana, memberId: m("bob") })).rejects.toThrow();
  });
});
