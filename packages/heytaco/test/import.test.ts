// S102-S105, S76a: running an import plan through createApp with the in-memory ports.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { createApp, defaultSettings, type Instant, type WorkspaceId } from "@propi/app";
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
