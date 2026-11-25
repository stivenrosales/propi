// CLI `import` and `reconcile` (S103, S105, G6, G9) over synthetic exports in a temp dir outside the repo.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { sampleExport, writeHeyTacoExport } from "@propi/heytaco/testing";
import { runCli } from "../src/cli.ts";

const dirs: string[] = [];
function exportDir(mutate: (d: ReturnType<typeof sampleExport>) => ReturnType<typeof sampleExport> = (d) => d): string {
  const dir = mkdtempSync(join(tmpdir(), "propi-cli-"));
  dirs.push(dir);
  writeHeyTacoExport(dir, mutate(sampleExport()));
  return dir;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, (l) => out.push(l), (l) => err.push(l));
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("reconcile", () => {
  test("S103 G9 S105: a consistent export reconciles with 0 diffs, complete rows and an idempotent re-import, exit 0", async () => {
    const r = await cli("reconcile", exportDir());
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);
    expect(report).toMatchObject({
      ok: true,
      currentUsers: 2,
      activityRowsRead: 4,
      activityRowsImported: 4,
      rowsByType: { message: 2, reaction: 1, sticker: 1 },
      redemptionRowsRead: 2,
      redemptionRowsImported: 2,
      redemptionsMatchedByEmailOnly: 1,
      redemptionsFulfilled: 1,
      redemptionsApproved: 1,
      bonusEntries: 1,
      historicalDeactivatedMembers: 1,
      secondImportAdded: 0,
      givenByCurrentMembers: 4,
      ledgerCheck: true,
      membersWithDiff: { received: 0, given: 0, redeemable: 0, any: 0 },
    });
  });

  test("S103: reconcile prints aggregate counts only, never emails or Slack ids", async () => {
    const r = await cli("reconcile", exportDir());
    expect(r.out).not.toMatch(/@|U1|U2|U9/);
  });

  test("S103: a balance that differs from users.xlsx exits 1", async () => {
    const dir = exportDir((d) => ({ ...d, users: d.users.map((u) => (u.uid === "U1" ? { ...u, received: 99 } : u)) }));
    const r = await cli("reconcile", dir);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, membersWithDiff: { received: 1, any: 1 } });
  });

  test("G9: a redemption that cannot be imported exits 1 even if user totals still match", async () => {
    // The departed person's redemption of 0 is refused (invalid_amount); current users are unaffected.
    const dir = exportDir((d) => ({ ...d, redemptions: d.redemptions.map((x) => (x.uid === "U9" ? { ...x, amount: 0 } : x)) }));
    const r = await cli("reconcile", dir);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, redemptionRowsRead: 2, redemptionRowsImported: 1, rejected: { invalid_amount: 1 }, membersWithDiff: { any: 0 } });
  });
});

describe("import", () => {
  test("S105: import reports what it wrote and stores nothing yet (memory storage)", async () => {
    const r = await cli("import", exportDir());
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ storage: "memory", until: null, membersCreated: 3, applied: 7, replayed: 0, rejected: {}, activityRowsRead: 4, activityRowsSkippedByCutoff: 0 });
  });

  test("G6: --until imports only rows strictly before the cutoff", async () => {
    const r = await cli("import", exportDir(), "--until", "2026-01-12T00:00:00-05:00");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ until: "2026-01-12T05:00:00.000Z", activityRowsRead: 3, activityRowsSkippedByCutoff: 1, redemptionRowsRead: 0, redemptionRowsSkippedByCutoff: 2 });
  });

  test("G6: a bare local --until is read in the export timezone (America/Bogota)", async () => {
    const r = await cli("import", exportDir(), "--until", "2026-01-12 00:00:00");
    expect(JSON.parse(r.out)).toMatchObject({ until: "2026-01-12T05:00:00.000Z" });
  });

  test("G6: an invalid --until is a usage error (exit 2)", async () => {
    const r = await cli("import", exportDir(), "--until", "yesterday");
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--until/);
  });
});

describe("usage", () => {
  test("S101: an unknown command or a missing directory prints usage and exits 2", async () => {
    expect((await cli("frobnicate")).code).toBe(2);
    const r = await cli("reconcile");
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/usage: propi/);
  });

  test("S101: --help prints usage and exits 0", async () => {
    const r = await cli("--help");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/import <dir> \[--until <timestamp>\]/);
    expect(r.out).toMatch(/reconcile <dir>/);
  });

  test("S101: an unreadable export directory exits 1 with the reason", async () => {
    const empty = mkdtempSync(join(tmpdir(), "propi-cli-empty-"));
    dirs.push(empty);
    const r = await cli("reconcile", empty);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/users\.xlsx not found/);
  });
});
