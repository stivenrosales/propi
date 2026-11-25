// S102-S105, S76a: running an import plan through createApp with the in-memory ports.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { createApp, defaultSettings, type CommandKey, type Instant, type WorkspaceId } from "@propi/app";
import { createMemoryPorts } from "@propi/app/testing";
import { HEYTACO_HANDLERS, importHeyTaco, planHeyTacoImport, readHeyTacoExport, type MemberRegistrar } from "../src/index.ts";
import { sampleExport, writeHeyTacoExport } from "../src/testing/index.ts";

const WS = "ws-ht" as WorkspaceId;
const dir = mkdtempSync(join(tmpdir(), "propi-heytaco-import-"));
writeHeyTacoExport(dir, sampleExport());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function world(now = Date.UTC(2026, 0, 20, 15, 0, 0)) {
  const mem = createMemoryPorts({ now });
  const settings = defaultSettings({ timezone: "America/Bogota" });
  mem.addWorkspace(WS, settings);
  const app = createApp(mem.ports, { handlers: HEYTACO_HANDLERS });
  const registrar: MemberRegistrar = { register: async (ws, member) => mem.addMember(ws, member) };
  return { mem, app, settings, registrar };
}

const plan = (settings = defaultSettings({ timezone: "America/Bogota" }), until: Instant | null = null) =>
  planHeyTacoImport(readHeyTacoExport(dir), { workspaceId: WS, settings, until, known: [] });

describe("S103 S105 import through the app", () => {
  test("S103: after import every current user's received, given and redeemable equal users.xlsx", async () => {
    const { app, mem, settings, registrar } = world();
    const p = plan(settings);
    const run = await importHeyTaco({ app, registrar, workspaceId: WS, plan: p });
    expect(run).toMatchObject({ membersCreated: 3, applied: p.commands.length, replayed: 0, rejected: {} });
    for (const u of p.expected) {
      const b = await app.balances(WS, u.memberId);
      expect({ received: b.received, given: b.given, redeemable: b.redeemable }).toEqual({ received: u.received, given: u.given, redeemable: u.redeemable });
    }
    expect((await app.ledgerCheck(WS)).ok).toBe(true);
  });

  test("S105: importing the same files again adds no entry and replays every command", async () => {
    const { app, mem, settings, registrar } = world();
    await importHeyTaco({ app, registrar, workspaceId: WS, plan: plan(settings) });
    const before = mem.entries(WS).length;
    const again = await importHeyTaco({ app, registrar, workspaceId: WS, plan: plan(settings) });
    expect(mem.entries(WS).length).toBe(before);
    expect(again).toMatchObject({ applied: 0, rejected: {} });
    expect(again.replayed).toBe(plan(settings).commands.length);
  });

  test("S102: people who left are registered as deactivated members; current users stay active", async () => {
    const { app, mem, settings, registrar } = world();
    const p = plan(settings);
    await importHeyTaco({ app, registrar, workspaceId: WS, plan: p });
    const records = await mem.ports.directory.members(WS);
    expect(records.filter((r) => r.active)).toHaveLength(2);
    expect(records.filter((r) => !r.active)).toHaveLength(1);
    expect(records.find((r) => r.dailyLimitOverride === 8)).toBeDefined();
  });

  test("S76a: imported stickers count to received but never consume today's allowance", async () => {
    const { app, mem, settings, registrar } = world(Date.UTC(2026, 0, 11, 20, 0, 0)); // same Bogota day as the sticker
    const p = plan(settings);
    await importHeyTaco({ app, registrar, workspaceId: WS, plan: p });
    expect(mem.entries(WS).every((e) => e.allowanceDay === null)).toBe(true);
    expect(mem.entries(WS).filter((e) => e.kind === "gift" && e.source === "sticker")).toHaveLength(1);
    expect(mem.events(WS)).toEqual([]);
    for (const m of p.members) expect((await app.allowance(WS, m.id)).used).toBe(0);
  });

  test("S101: imported entries, gifts and redemptions keep HeyTaco's timestamps, not the import run's clock", async () => {
    const runAt = Date.UTC(2026, 10, 25, 15, 0, 0);
    const { app, mem, settings, registrar } = world(runAt);
    const p = plan(settings);
    await importHeyTaco({ app, registrar, workspaceId: WS, plan: p });
    const atByKey = new Map(p.commands.map((c) => [c.key as string, c.at]));
    const entries = mem.entries(WS);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.at).toBe(atByKey.get(e.commandKey));
    expect(entries.every((e) => e.at < runAt)).toBe(true);
    expect(mem.commandLog(WS).every((r) => r.at === atByKey.get(r.key))).toBe(true);
    const giftAt = new Map(p.commands.filter((c) => c.type === "ImportHeyTacoGift").map((c) => [c.giftId as string, c.at]));
    for (const g of mem.gifts(WS)) expect(g.createdAt).toBe(giftAt.get(g.id));
    for (const r of mem.shop.state(WS).redemptions) expect(r.createdAt).toBeLessThan(runAt);
  });

  test("S101: live commands still run at the server clock, whatever `at` they carry", async () => {
    const runAt = Date.UTC(2026, 10, 25, 15, 0, 0);
    const { app, mem } = world(runAt);
    const admin = { kind: "member", memberId: "boss", role: "admin" } as never;
    mem.addMember(WS, { id: "boss" as never, role: "admin", active: true, dailyLimitOverride: null });
    await app.execute({ type: "GrantBonus", key: "web:bonus:1" as CommandKey, workspaceId: WS, actor: admin, at: 0 as Instant, memberIds: ["boss" as never], amount: 3 as never, reason: "x" });
    expect(mem.entries(WS).map((e) => e.at)).toEqual([runAt]);
  });

  test("S104: imported redemptions become shop redemptions: Fulfilled 1 -> fulfilled, 0 -> approved", async () => {
    const { app, mem, settings, registrar } = world();
    const p = plan(settings);
    await importHeyTaco({ app, registrar, workspaceId: WS, plan: p });
    const cmds = p.commands.filter((c) => c.type === "ImportHeyTacoRedemption");
    const records = mem.shop.state(WS).redemptions;
    expect(records).toHaveLength(cmds.length);
    for (const c of cmds) {
      expect(records.find((r) => r.id === c.redemptionId)).toEqual({
        id: c.redemptionId,
        memberId: c.memberId,
        rewardId: null,
        variantId: null,
        collabId: null,
        cost: c.amount,
        internalCost: null,
        budgetMonth: null,
        stockReserved: false,
        giftCard: false,
        cardIssued: false,
        onBehalfOf: "self",
        state: c.state,
        createdAt: c.at,
        updatedAt: c.at,
        reason: c.title,
      });
    }
    expect(records.map((r) => r.state).sort()).toEqual(["approved", "fulfilled"]);
    // History is not news: importing notifies nobody.
    expect(mem.events(WS)).toEqual([]);
  });

  test("S104: an imported approved redemption is fulfilled or cancelled through the shop like any other", async () => {
    const { app, mem, settings, registrar } = world();
    const p = plan(settings);
    await importHeyTaco({ app, registrar, workspaceId: WS, plan: p });
    const approved = mem.shop.state(WS).redemptions.find((r) => r.state === "approved")!;
    const fulfilled = mem.shop.state(WS).redemptions.find((r) => r.state === "fulfilled")!;
    const system = { kind: "system", job: "test" } as const;
    const transition = (k: string, redemptionId: string, t: "fulfil" | "cancel") =>
      app.execute({ type: "TransitionRedemption", key: k as CommandKey, workspaceId: WS, actor: system, at: 0 as Instant, redemptionId, transition: t, reason: null });
    expect(await transition("t:1", approved.id, "fulfil")).toMatchObject({ ok: true, value: { state: "fulfilled", changed: true, refunded: 0 } });
    // S53: fulfilling the already-fulfilled import again is an idempotent no-op; S49: it cannot be cancelled.
    expect(await transition("t:2", fulfilled.id, "fulfil")).toMatchObject({ ok: true, value: { state: "fulfilled", changed: false } });
    expect(await transition("t:3", fulfilled.id, "cancel")).toMatchObject({ ok: false, error: { code: "illegal_transition", from: "fulfilled" } });
    expect(mem.shop.state(WS).redemptions.every((r) => r.state === "fulfilled")).toBe(true);
  });

  test("S104 S105: re-importing creates no second redemption record", async () => {
    const { app, mem, settings, registrar } = world();
    await importHeyTaco({ app, registrar, workspaceId: WS, plan: plan(settings) });
    const before = mem.shop.state(WS).redemptions;
    await importHeyTaco({ app, registrar, workspaceId: WS, plan: plan(settings) });
    expect(mem.shop.state(WS).redemptions).toEqual(before);
  });

  test("S104: each imported redemption result keeps its state", async () => {
    const { app, mem, settings, registrar } = world();
    const p = plan(settings);
    const run = await importHeyTaco({ app, registrar, workspaceId: WS, plan: p });
    expect(run.redemptionStates).toEqual({ fulfilled: 1, approved: 1 });
  });

  test("S105 G6: an import with --until stops before the cutoff", async () => {
    const { app, mem, settings, registrar } = world();
    const until = Date.UTC(2026, 0, 12, 0, 0, 0) as Instant;
    const p = plan(settings, until);
    await importHeyTaco({ app, registrar, workspaceId: WS, plan: p });
    expect(mem.entries(WS).filter((e) => e.kind === "gift")).toHaveLength(3);
    expect(mem.entries(WS).filter((e) => e.kind === "spend")).toHaveLength(0);
  });
});
