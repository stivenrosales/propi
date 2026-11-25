// Real-Postgres support for server tests: a fresh migrated database per file, dropped afterwards.
// Skipped when DATABASE_URL is unset. Mirrors packages/db/test/pg.ts.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";
import { createPrismaClient, type PrismaClient } from "@propi/db";

export const DATABASE_URL = process.env["DATABASE_URL"];
export const hasDatabase = DATABASE_URL !== undefined && DATABASE_URL !== "";
const dbDir = join(import.meta.dirname, "..", "..", "..", "packages", "db");

export async function createTestDatabase(): Promise<{ readonly client: PrismaClient; drop(): Promise<void> }> {
  if (!hasDatabase) throw new Error("DATABASE_URL is not set");
  const name = `propi_server_test_${randomBytes(6).toString("hex")}`;
  const admin = createPrismaClient(DATABASE_URL!, { maxConnections: 1 });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(DATABASE_URL!);
  url.pathname = `/${name}`;
  await promisify(execFile)(join(dbDir, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], { cwd: dbDir, env: { ...process.env, DATABASE_URL: url.toString() } });
  const client = createPrismaClient(url.toString(), { maxConnections: 10 });
  return {
    client,
    async drop() {
      await client.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
    },
  };
}
