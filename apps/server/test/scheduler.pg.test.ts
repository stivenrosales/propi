// The scheduler and the HeyTaco import against real Postgres (S34, S84, S90, S91, S101-S105, G6).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Instant, WorkspaceId } from "@propi/app";
import type { DigestSummary, Summarizer } from "@propi/core/insights";
import { createSecretCipher } from "@propi/db";
import { sampleExport, writeHeyTacoExport } from "@propi/heytaco/testing";
import { importIntoWorkspace } from "../src/import.ts";
import { ensureInstalled } from "../src/install.ts";
import { createSlackLookup } from "../src/lookup.ts";
import { relayOnce } from "../src/relay.ts";
import { createRuntime, type Runtime } from "../src/runtime.ts";
import { createScheduler } from "../src/scheduler.ts";
import { fakeSlack } from "./fakes.ts";
import { createTestDatabase, hasDatabase } from "./pg.ts";

const TEAM = "T0PROPI001";
const MONDAY_0930_LIMA = Date.parse("2026-11-30T14:30:00Z");
const DEC_1_0930_LIMA = Date.parse("2026-12-01T14:30:00Z");

let db: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
let now = MONDAY_0930_LIMA;
const summaries: string[] = [];
const summarizer: Summarizer = {
  async summarize(input): Promise<DigestSummary> {
    summaries.push(input.month);
    return { team: [{ title: "Teamwork", summary: "People helped each other.", valueId: null, giftIds: [] }], members: [] };
  },
};
const scratch = mkdtempSync(join(tmpdir(), "propi-server-import-"));

function runtime(withSummarizer: boolean): Runtime {
  let n = 0;
  return createRuntime(db!.client, {
    cipher: createSecretCipher("11".repeat(32)),
    clock: { now: () => now as Instant },
    ids: { next: (kind) => `${kind}-${withSummarizer ? "s" : "p"}-${++n}` },
    summarizer: withSummarizer ? summarizer : null,
  });
}

let rt: Runtime;
let ws: WorkspaceId;

beforeAll(async () => {
  if (!hasDatabase) return;
  db = await createTestDatabase();
  rt = runtime(false);
  ws = (await ensureInstalled(rt, { teamId: TEAM, installerUserId: "U0BOSS0001", timezone: "America/Lima", now: now as Instant })).workspaceId;
}, 120_000);
afterAll(async () => {
  rmSync(scratch, { recursive: true, force: true });
  await db?.drop();
});

describe.skipIf(!hasDatabase)("scheduler on Postgres", () => {
  test("S84 S34: Monday 09:30 sends the weekly report once and runs the ledger check; a second tick runs nothing", async () => {
    const logs: string[] = [];
    const scheduler = createScheduler({ rt, workspaces: async () => [ws], log: (m) => void logs.push(m) });
    const first = await scheduler.tick(now as Instant);
    expect(first).toMatchObject({ workspaces: 1, errors: 0, ran: { weekly_report: 1, isolation: 1, ledger_check: 1 } });
    expect(logs).toContain("gift-card relay skipped: no provider configured (S108)");

    // A restarted process (fresh scheduler) replays the job key instead of sending again.
    const restarted = createScheduler({ rt, workspaces: async () => [ws], log: () => undefined });
    expect((await restarted.tick(now as Instant)).ran).toEqual({ ledger_check: 1 });
    expect((await scheduler.tick(now as Instant)).ran).toEqual({});

    const slack = fakeSlack();
    const pass = await relayOnce({ rt, lookup: createSlackLookup(rt, slack.api), slack: slack.api, appUrl: "https://propi.example", log: () => undefined });
    expect(pass.slackSent).toBeGreaterThanOrEqual(1);
    expect(slack.posted.map((p) => p.channel)).toContain("DM:U0BOSS0001");
    expect(slack.posted.find((p) => p.text.startsWith("Your week in tacos (2026-W49)"))).toBeDefined();
  });

  test("S91: without OPENROUTER_API_KEY the digest is skipped and logged; with a Summarizer admins get it once", async () => {
    now = DEC_1_0930_LIMA;
    const logs: string[] = [];
    const off = createScheduler({ rt, workspaces: async () => [ws], log: (m) => void logs.push(m) });
    const r = await off.tick(now as Instant);
    expect(r.skipped).toContain("digest");
    expect(logs).toContain("monthly AI digest skipped: OPENROUTER_API_KEY is not set (S91)");
    expect(r.ran).toMatchObject({ reciprocity: 1 });

    const withAi = runtime(true);
    const on = createScheduler({ rt: withAi, workspaces: async () => [ws], log: () => undefined });
    expect((await on.tick(now as Instant)).ran).toMatchObject({ digest: 1 });
    expect((await on.tick(now as Instant)).ran.digest).toBeUndefined();
    expect(summaries).toEqual(["2026-11"]);
    const slack = fakeSlack();
    await relayOnce({ rt: withAi, lookup: createSlackLookup(withAi, slack.api), slack: slack.api, appUrl: null, log: () => undefined });
    expect(slack.posted.find((p) => p.text === "Recognition digest for 2026-11")?.channel).toBe("DM:U0BOSS0001");
  });
});

describe.skipIf(!hasDatabase)("HeyTaco import into Postgres", () => {
  test("S101-S105: imports into the installed workspace, links Slack identities, re-import adds 0, aggregates only", async () => {
    const dir = join(scratch, "export");
    writeHeyTacoExport(dir, sampleExport());
    const first = await importIntoWorkspace(rt, { dir, team: TEAM, until: null });
    expect(first.ok).toBe(true);
    expect(first.report).toMatchObject({ storage: "postgres", ledgerCheck: true, replayed: 0, rejected: {} });
    expect(first.report.applied).toBeGreaterThan(0);
    expect(first.report.identitiesLinked).toBeGreaterThan(0);
    expect(JSON.stringify(first.report)).not.toMatch(/@|"U\d/);

    const again = await importIntoWorkspace(rt, { dir, team: TEAM, until: null });
    expect(again.report).toMatchObject({ applied: 0, membersCreated: 0, replayed: first.report.applied });

    // S107: a live Slack user from the export resolves to the imported member, no new member.
    const lookup = createSlackLookup(rt, fakeSlack().api);
    const before = (await rt.ports.directory.members(ws)).length;
    expect(await lookup.actor(ws, TEAM, "U1")).toMatchObject({ kind: "member" });
    expect((await rt.ports.directory.members(ws)).length).toBe(before);
  });

  test("G6: --until skips later rows", async () => {
    const dir = join(scratch, "export-until");
    writeHeyTacoExport(dir, sampleExport());
    const r = await importIntoWorkspace(rt, { dir, team: TEAM, until: Date.parse("2000-01-01T00:00:00Z") as Instant });
    expect(r.report.activityRowsRead).toBe(0);
    expect(r.report.activityRowsSkippedByCutoff).toBeGreaterThan(0);
  });

  test("an uninstalled-never team is refused", async () => {
    await expect(importIntoWorkspace(rt, { dir: scratch, team: "T0NOTHERE1", until: null })).rejects.toThrow(/not installed/);
  });
});
