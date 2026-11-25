// Static checks of the hand-written migrations. No database needed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EFFECTS } from "@propi/core";
import { ledgerCheckConstraints } from "../src/index.ts";

const migrationsDir = join(import.meta.dirname, "..", "prisma", "migrations");
const allSql = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((d) => readFileSync(join(migrationsDir, d.name, "migration.sql"), "utf8"))
  .join("\n");

describe("migrations", () => {
  test("G1: the ledger sign CHECKs in the migration are exactly the ones generated from EFFECTS", () => {
    const checks = ledgerCheckConstraints();
    expect(checks).toHaveLength(Object.keys(EFFECTS).length + 2);
    for (const stmt of checks) expect(allSql).toContain(stmt);
    const declared = allSql.match(/CONSTRAINT "ledger_entry_sign_\w+"/g) ?? [];
    expect(declared.sort()).toEqual(Object.keys(EFFECTS).map((k) => `CONSTRAINT "ledger_entry_sign_${k}"`).sort());
  });

  test("S30: ledger_entry, command_log and domain_event get append-only triggers", () => {
    for (const table of ["ledger_entry", "command_log", "domain_event"]) {
      expect(allSql).toMatch(new RegExp(`CREATE TRIGGER "${table}_append_only"\\s+BEFORE UPDATE OR DELETE ON "${table}"`));
      expect(allSql).toMatch(new RegExp(`CREATE TRIGGER "${table}_no_truncate"\\s+BEFORE TRUNCATE ON "${table}"`));
    }
  });

  test("S17: ledger rows are unique per (workspace, command key, ordinal)", () => {
    expect(allSql).toContain(`CONSTRAINT "ledger_entry_command_ordinal_key" UNIQUE ("workspace_id", "command_key", "ordinal")`);
  });
});
