// Database-level guarantees, checked directly with SQL against a migrated database.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { EFFECTS, defaultSettings, type EntryKind, type WorkspaceId } from "@propi/core";
import { createDbAdmin, type PrismaClient } from "../src/index.ts";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./pg.ts";

const WS = "ws-constraints" as WorkspaceId;
let db: TestDatabase;
let sql: PrismaClient;

describe.skipIf(!hasDatabase)("database constraints", () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    sql = db.client(4);
    await createDbAdmin(sql).addWorkspace(WS, defaultSettings());
    await sql.$executeRaw`INSERT INTO member (workspace_id, id, role) VALUES (${WS}, 'ana', 'member')`;
    await sql.$executeRaw`
      INSERT INTO command_log (workspace_id, key, request_hash, status, command_type, actor, command, result, at)
      VALUES (${WS}, 'k1', 'h', 'done', 'Test', '{}'::jsonb, '{}'::jsonb, '{"ok":true}'::jsonb, now())`;
  }, 120_000);
  afterAll(async () => {
    await db?.drop();
  });

  let ordinal = 0;
  const insertEntry = (kind: string, amount: number, key = "k1", ord = ++ordinal) =>
    sql.$executeRaw`
      INSERT INTO ledger_entry (workspace_id, command_key, ordinal, kind, amount, member_id, cause_type, cause, at)
      VALUES (${WS}, ${key}, ${ord}, ${kind}, ${amount}, 'ana', 'admin', '{"type":"admin"}'::jsonb, now())`;

  test("G1: every kind accepts only its EFFECTS sign, and zero and unknown kinds are refused", async () => {
    for (const [kind, fx] of Object.entries(EFFECTS) as [EntryKind, (typeof EFFECTS)[EntryKind]][]) {
      await expect(insertEntry(kind, fx.sign * 3)).resolves.toBe(1);
      await expect(insertEntry(kind, -fx.sign * 3)).rejects.toThrow(new RegExp(`ledger_entry_sign_${kind}`));
      await expect(insertEntry(kind, 0)).rejects.toThrow(/ledger_entry_amount_nonzero|ledger_entry_sign_/);
    }
    await expect(insertEntry("gift_card", 1)).rejects.toThrow(/ledger_entry_kind_known/);
  });

  test("S17: a (workspace, command key, ordinal) can hold only one ledger row", async () => {
    await insertEntry("bonus", 1, "k1", 900);
    await expect(insertEntry("bonus", 1, "k1", 900)).rejects.toThrow(/ledger_entry_command_ordinal_key/);
  });

  test("S30: ledger entries cannot be updated, deleted or truncated", async () => {
    await insertEntry("bonus", 2);
    await expect(sql.$executeRaw`UPDATE ledger_entry SET amount = 99 WHERE workspace_id = ${WS}`).rejects.toThrow(/append-only/);
    await expect(sql.$executeRaw`DELETE FROM ledger_entry WHERE workspace_id = ${WS}`).rejects.toThrow(/append-only/);
    await expect(sql.$executeRawUnsafe(`TRUNCATE ledger_entry CASCADE`)).rejects.toThrow(/append-only/);
    const [row] = await sql.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM ledger_entry WHERE amount = 99`;
    expect(row?.n).toBe(0);
  });

  test("S30: domain events cannot be updated or deleted", async () => {
    await sql.$executeRaw`
      INSERT INTO domain_event (id, workspace_id, command_key, ordinal, type, payload, at)
      VALUES ('ev-1', ${WS}, 'k1', 0, 'test', '{}'::jsonb, now())`;
    await expect(sql.$executeRaw`UPDATE domain_event SET type = 'x' WHERE id = 'ev-1'`).rejects.toThrow(/append-only/);
    await expect(sql.$executeRaw`DELETE FROM domain_event WHERE id = 'ev-1'`).rejects.toThrow(/append-only/);
  });

  test("G2: a command_log row changes once, running -> done, and never again", async () => {
    await sql.$executeRaw`INSERT INTO command_log (workspace_id, key, request_hash, status) VALUES (${WS}, 'k2', 'h2', 'running')`;
    // A done row must carry its result.
    await expect(sql.$executeRaw`UPDATE command_log SET status = 'done' WHERE workspace_id = ${WS} AND key = 'k2'`).rejects.toThrow(/command_log_done_is_complete/);
    await expect(sql.$executeRaw`UPDATE command_log SET request_hash = 'other' WHERE workspace_id = ${WS} AND key = 'k2'`).rejects.toThrow(/append-only/);
    await expect(sql.$executeRaw`
      UPDATE command_log SET status = 'done', command_type = 'T', actor = '{}'::jsonb, command = '{}'::jsonb, result = '{"ok":true}'::jsonb, at = now()
      WHERE workspace_id = ${WS} AND key = 'k2'`).resolves.toBe(1);
    await expect(sql.$executeRaw`UPDATE command_log SET result = '{"ok":false}'::jsonb WHERE workspace_id = ${WS} AND key = 'k2'`).rejects.toThrow(/append-only/);
    await expect(sql.$executeRaw`DELETE FROM command_log WHERE workspace_id = ${WS} AND key = 'k2'`).rejects.toThrow(/append-only/);
  });
});
