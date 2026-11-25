// Read-model contract for boards, notifications, insights and the export (S43, S69, S71, S80-S91).
// One history is written through createApp() into the in-memory ports and into Postgres. Then
// app's query functions over each source, and the SQL leaderboard / values report, must return
// exactly the same answers.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  boardQueries,
  createApp,
  defaultSettings,
  insightsQueries,
  notifyQueries,
  privacyQueries,
  type Actor,
  type App,
  type CommandKey,
  type InboundMessage,
  type Instant,
  type LocalDate,
  type MemberRecord,
  type PosInt,
  type Ports,
  type Redemption,
  type ShopReader,
  type Value,
  type ValueId,
  type WorkspaceId,
} from "@propi/app";
import type { BoardKind, InsightsSettings, InsightsSource, Timeframe } from "@propi/core/boards";
import type { EnabledDigestInput, Summarizer } from "@propi/core/insights";
import type { NotificationPreferences } from "@propi/core/notify";
import { createMemoryInsights, createMemoryPorts } from "@propi/app/testing";
import { createDbAdmin, createDbInsights, createDbInspector, createDbPorts, exportRedemptionRow, type DbInsights, type PrismaClient } from "../src/index.ts";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./pg.ts";
import { admin, m, memberActor, mention } from "./harness.ts";

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

const WS = "ws-insights" as WorkspaceId;
/** 10:00 in Lima on a local date. */
const lima = (date: string, hour = 10) => {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, mo - 1, d, hour + 5) as Instant;
};
const NOW = lima("2026-11-27", 9); // a Friday (S86 nudge day)
const VALUES: Value[] = [
  { id: "v-own" as ValueId, name: "Ownership", hashtag: "#ownership", emoji: ":muscle:" },
  { id: "v-fun" as ValueId, name: "Fun", hashtag: "#fun", emoji: ":tada:" },
];
const MEMBERS = ["giver", "ana", "diana", "lind", "bob", "carl"];
/**
 * Every member, inserted in id order: Postgres Directory.members() lists by id while the memory
 * fake keeps insertion order, and plans such as S84 follow that order.
 */
const PEOPLE: MemberRecord[] = [
  ...MEMBERS.map((id) => ({ id: m(id), role: "member" as const, active: true, dailyLimitOverride: null })),
  { id: m("boss"), role: "admin" as const, active: true, dailyLimitOverride: null },
  { id: m("gone"), role: "member" as const, active: false, dailyLimitOverride: null },
].sort((a, b) => (a.id < b.id ? -1 : 1));

/** Writes and the settings/preferences a source needs, over either backend. */
interface World {
  readonly app: App;
  readonly ports: Ports;
  readonly source: InsightsSource;
  setNow(ms: number): void;
  setSettings(over: Partial<InsightsSettings>): Promise<void>;
  setPreferences(member: string, p: NotificationPreferences): Promise<void>;
  /** The memory fake holds export rows by hand; Postgres reads them from the shop tables. */
  syncRedemptions(rows: readonly Redemption[]): void;
}

async function memoryWorld(): Promise<World> {
  const mem = createMemoryPorts({ now: NOW });
  mem.addWorkspace(WS, defaultSettings({ timezone: "America/Lima", privateChannelsAllowed: true }));
  for (const r of PEOPLE) mem.addMember(WS, r);
  mem.setValues(WS, VALUES);
  const insights = createMemoryInsights(mem);
  return {
    app: createApp(mem.ports),
    ports: mem.ports,
    source: insights.source,
    setNow: (ms) => mem.clock.set(ms),
    setSettings: async (over) => insights.setSettings(WS, over),
    setPreferences: async (member, p) => insights.setPreferences(WS, m(member), p),
    syncRedemptions: (rows) => rows.forEach((r) => insights.addRedemption(WS, exportRedemptionRow(r))),
  };
}

async function postgresWorld(): Promise<World & { readonly insights: DbInsights }> {
  if (pg === undefined) throw new Error("no database");
  let now = NOW as number;
  let n = 0;
  const ports = createDbPorts(pg, { clock: { now: () => now as Instant }, ids: { next: (kind) => `${kind}-${++n}` } });
  const dbAdmin = createDbAdmin(pg);
  await dbAdmin.addWorkspace(WS, defaultSettings({ timezone: "America/Lima", privateChannelsAllowed: true }));
  for (const r of PEOPLE) await dbAdmin.addMember(WS, r);
  await dbAdmin.setValues(WS, VALUES);
  const insights = createDbInsights(pg);
  return {
    app: createApp(ports),
    ports,
    source: insights.source,
    insights,
    setNow: (ms) => void (now = ms),
    setSettings: (over) => insights.setSettings(WS, over),
    setPreferences: (member, p) => insights.setPreferences(WS, m(member), p),
    syncRedemptions: () => undefined,
  };
}

/** The same history on both backends: gifts over four weeks, tags, channels, a reversal, a redemption. */
async function writeHistory(w: World): Promise<void> {
  let k = 0;
  const give = async (from: string, to: string[], units: number, day: string, o: { tags?: string[]; channel?: InboundMessage["channel"]; text?: string } = {}) => {
    w.setNow(lima(day));
    const ref = `T:C:${++k}`;
    const message: InboundMessage = {
      channel: o.channel ?? { id: "C1", kind: "public" },
      text: o.text ?? `${to.map((t) => `@${t}`).join(" ")} thanks ${(o.tags ?? []).join(" ")}`,
      mentions: to.map(mention),
      emojiTokens: Array.from({ length: units }, () => ":taco:"),
      hashtags: o.tags ?? [],
    };
    const r = await w.app.execute({ type: "GiveByMessage", key: `slack:msg:${ref}` as CommandKey, workspaceId: WS, actor: memberActor(from), at: lima(day), messageRef: ref, message });
    if (!r.ok) throw new Error(`gift failed: ${JSON.stringify(r)}`);
    return ref;
  };
  const base = (key: string, actor: Actor = admin) => ({ key: key as CommandKey, workspaceId: WS, actor, at: w.ports.clock.now() });

  await give("giver", ["ana"], 2, "2026-11-02", { tags: ["#ownership"] });
  await give("ana", ["giver"], 1, "2026-11-03", { tags: ["#fun"] });
  await give("giver", ["ana"], 2, "2026-11-10", { tags: ["#ownership", "#fun"] });
  await give("ana", ["giver"], 2, "2026-11-11");
  await give("giver", ["ana"], 1, "2026-11-12", { channel: { id: "C2", kind: "private" } });
  await give("ana", ["giver"], 2, "2026-11-13", { channel: { id: "C3", kind: "public" } });
  await give("bob", ["diana", "lind"], 1, "2026-11-23", { tags: ["#fun"] });
  await give("diana", ["bob"], 3, "2026-11-24", { tags: ["#ownership"] });
  const reversed = await give("bob", ["diana"], 2, "2026-11-25", { tags: ["#ownership"] });
  await give("lind", ["giver", "bob"], 1, "2026-11-26");
  await give("boss", ["carl"], 1, "2026-11-26", { channel: { id: "C3", kind: "public" } });
  await give("ana", ["diana"], 1, "2026-10-30", { tags: ["#fun"] });

  // The giver deletes one message the same day: a gift_reversal line (S22).
  w.setNow(lima("2026-11-25", 12));
  await w.app.execute({ type: "DeleteMessage", ...base(`slack:del:${reversed}`, memberActor("bob")), messageRef: reversed });
  await w.app.execute({ type: "GrantBonus", ...base("adm:bonus"), memberIds: [m("carl")], amount: 20 as PosInt, reason: "welcome" });

  // A redemption for the S71 export.
  const reward = await w.app.execute({
    type: "CreateReward",
    ...base("shop:reward"),
    reward: { title: "Mug", description: "", image: null, cost: 10, stock: null, variants: [], categories: [], internalCost: null, instructions: "", autoApprove: false, giftCard: false },
  });
  if (!reward.ok) throw new Error(JSON.stringify(reward));
  await w.app.execute({ type: "SetRewardStatus", ...base("shop:activate"), rewardId: reward.value.rewardId, status: "active" });
  const redeemed = await w.app.execute({ type: "Redeem", ...base("shop:redeem", memberActor("carl")), memberId: m("carl"), rewardId: reward.value.rewardId, variantId: null });
  if (!redeemed.ok) throw new Error(JSON.stringify(redeemed));
  w.syncRedemptions(await (w.ports.reader.workspace(WS) as unknown as ShopReader).redemptions());

  await w.setSettings({ excludedFromBoards: [m("lind")] });
  await w.setSettings({ isolationWeeks: 2, reciprocity: { minSharePercent: 50, minGifts: 4 } });
  await w.setPreferences("ana", { weekly_report: false });
  await w.setPreferences("bob", { nudge: false, gift_received: false });
  w.setNow(NOW);
}

const TIMEFRAMES: Timeframe[] = [
  { kind: "today" },
  { kind: "week" },
  { kind: "month" },
  { kind: "year" },
  { kind: "all" },
  { kind: "custom", from: "2026-11-10" as LocalDate, to: "2026-11-24" as LocalDate },
];
const BOARDS: BoardKind[] = ["received", "given", "combined"];
const FILTERS = [{}, { channelId: "C1" }, { channelId: "C3" }, { valueId: "v-own" as ValueId }, { valueId: "v-fun" as ValueId, limit: 1 }, { limit: 2 }];

const echoSummarizer: Summarizer = {
  async summarize(input: EnabledDigestInput) {
    return { team: [], members: input.members.map((x) => ({ memberId: x.memberId, themes: [] })) };
  },
};

/** Every query the apps run on these read models. */
async function answers(w: World) {
  const deps = { ports: w.ports, source: w.source, summarizer: echoSummarizer };
  const boards = boardQueries(deps);
  const insights = insightsQueries(deps);
  const notify = notifyQueries(deps);
  const privacy = privacyQueries(deps);
  const leaderboards = [];
  for (const board of BOARDS) for (const timeframe of TIMEFRAMES) for (const f of FILTERS) leaderboards.push(await boards.leaderboard(WS, admin, { board, timeframe, ...f }));
  const events = (await w.ports.reader.workspace(WS).commandLog()).length;
  return {
    events,
    visible: [await boards.visibleBoards(WS, memberActor("ana")), await boards.visibleBoards(WS, admin)],
    leaderboards,
    values: await Promise.all(TIMEFRAMES.map((t) => boards.valuesReport(WS, t))),
    feed: [await boards.feed(WS, {}), await boards.feed(WS, { limit: 3 }), await boards.profile(WS, m("ana")), await boards.profile(WS, m("giver"), 2)],
    weekly: await Promise.all(MEMBERS.map((x) => boards.weeklyReport(WS, m(x)))),
    tv: [await boards.tvDisplay(WS), await boards.tvDisplay(WS, { feedSize: 2, boardSize: 2, timeframe: { kind: "all" } })],
    metrics: await Promise.all(TIMEFRAMES.map((t) => insights.adminMetrics(WS, admin, t))),
    forbidden: await insights.adminMetrics(WS, memberActor("ana"), { kind: "month" }),
    isolation: await insights.isolationAlerts(WS),
    reciprocity: await Promise.all(TIMEFRAMES.map((t) => insights.reciprocity(WS, admin, t))),
    digest: await insights.monthlyDigest(WS, "2026-11"),
    reports: await notify.weeklyReports(WS),
    nudges: await notify.nudges(WS),
    export: await privacy.exportAll(WS, admin),
  };
}

describe.skipIf(!hasDatabase)("boards and insights read models on Postgres (S43, S69, S71, S80-S91)", () => {
  let mem: World;
  let sql: Awaited<ReturnType<typeof postgresWorld>>;
  beforeAll(async () => {
    mem = await memoryWorld();
    sql = await postgresWorld();
    await writeHistory(mem);
    await writeHistory(sql);
  }, 60_000);

  test("S80-S91 S43 S69 S71: app queries over the Postgres source equal the memory source", async () => {
    const a = await answers(mem);
    const b = await answers(sql);
    expect(a.leaderboards.some((r) => r.ok && r.value.length > 0)).toBe(true);
    expect(a.export.ok && a.export.value.tables.redemptions.length).toBe(2);
    expect(b).toEqual(a);
  });

  test("S80 S82 S43: the SQL leaderboard and values report equal the core folds", async () => {
    const boards = boardQueries({ ports: mem.ports, source: mem.source });
    for (const board of BOARDS) {
      for (const timeframe of TIMEFRAMES) {
        for (const f of FILTERS) {
          const q = { board, timeframe, ...f };
          const expected = await boards.leaderboard(WS, admin, q);
          if (!expected.ok) throw new Error("admin sees every board");
          expect({ q, rows: await sql.insights.leaderboard(WS, q, NOW) }).toEqual({ q, rows: expected.value });
        }
      }
    }
    for (const timeframe of TIMEFRAMES) {
      expect({ timeframe, rows: await sql.insights.valuesReport(WS, timeframe, NOW) }).toEqual({ timeframe, rows: await boards.valuesReport(WS, timeframe) });
    }
  });

  test("S80: excluded and deactivated members are hidden from the SQL leaderboard", async () => {
    const rows = await sql.insights.leaderboard(WS, { board: "combined", timeframe: { kind: "all" } }, NOW);
    const ids = rows.map((r) => r.memberId);
    expect(ids).not.toContain("lind");
    expect(ids).not.toContain("gone");
    expect(ids).toContain("giver");
  });

  test("S85: setPreference turns one type off and keeps the others", async () => {
    expect(await sql.insights.setPreference(WS, m("diana"), "nudge", false)).toEqual({ nudge: false });
    expect(await sql.insights.setPreference(WS, m("diana"), "weekly_report", false)).toEqual({ nudge: false, weekly_report: false });
    expect(await sql.insights.setPreference(WS, m("diana"), "nudge", true)).toEqual({ nudge: true, weekly_report: false });
    expect((await sql.source.preferences(WS)).get(m("diana"))).toEqual({ nudge: true, weekly_report: false });
  });

  test("S69-S91: settings start at the defaults and merge partial updates", async () => {
    const fresh = "ws-insights-fresh" as WorkspaceId;
    await createDbAdmin(pg!).addWorkspace(fresh, defaultSettings());
    const before = await sql.source.settings(fresh);
    expect(before).toEqual(await createMemoryInsights(createMemoryPorts()).source.settings(fresh));
    await sql.insights.setSettings(fresh, { giverMode: true });
    await sql.insights.setSettings(fresh, { nudge: { enabled: false, weekday: 1 } });
    expect(await sql.source.settings(fresh)).toEqual({ ...before, giverMode: true, nudge: { enabled: false, weekday: 1 } });
  });

  test("ledger sums are BIGINT: totals past 2^31 units read back exactly", async () => {
    const big = "ws-insights-big" as WorkspaceId;
    const dbAdmin = createDbAdmin(pg!);
    await dbAdmin.addWorkspace(big, defaultSettings({ timezone: "America/Lima" }));
    await dbAdmin.addMember(big, { id: m("ana"), role: "member", active: true, dailyLimitOverride: null });
    let n = 0;
    const ports = createDbPorts(pg!, { clock: { now: () => NOW }, ids: { next: (kind) => `big-${kind}-${++n}` } });
    const max = 1_000_000; // MAX_ENTRY_AMOUNT
    const r = await createApp(ports).execute({ type: "GrantBonus", key: "adm:big" as CommandKey, workspaceId: big, actor: admin, at: NOW, memberIds: [m("ana")], amount: max as PosInt, reason: "big" });
    expect(r.ok).toBe(true);
    // 2,200 entries of the maximum amount (2.2e9 > 2^31), appended as copies of the real one.
    await pg!.$executeRaw`
      INSERT INTO ledger_entry (workspace_id, command_key, ordinal, kind, amount, member_id, counterpart_id, cause_type, cause_id, cause, source, allowance_day, at, reason)
      SELECT workspace_id, command_key, g, kind, amount, member_id, counterpart_id, cause_type, cause_id, cause, source, allowance_day, at, reason
      FROM ledger_entry, generate_series(1, 2199) AS g WHERE workspace_id = ${big}`;
    expect(await ports.reader.workspace(big).balances(m("ana"))).toEqual({ received: 0, given: 0, redeemable: 2200 * max });
    expect(await ports.reader.workspace(big).redeemableByMember()).toEqual(new Map([[m("ana"), 2200 * max]]));
  });
});
