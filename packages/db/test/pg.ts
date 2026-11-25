// Real-Postgres test support. Each test file gets its own fresh database, migrated with
// `prisma migrate deploy`, and dropped afterwards. Skipped entirely when DATABASE_URL is unset.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";
import { createPrismaClient, type PrismaClient } from "../src/index.ts";

export const DATABASE_URL = process.env["DATABASE_URL"];
export const hasDatabase = DATABASE_URL !== undefined && DATABASE_URL !== "";

const pkgDir = join(import.meta.dirname, "..");

export interface TestDatabase {
  readonly url: string;
  /** A new client on this database (e.g. a second "replica"). Closed by drop(). */
  client(maxConnections?: number): PrismaClient;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  if (!hasDatabase) throw new Error("DATABASE_URL is not set");
  const name = `propi_test_${randomBytes(6).toString("hex")}`;
  const adminClient = createPrismaClient(DATABASE_URL!, { maxConnections: 1 });
  await adminClient.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(DATABASE_URL!);
  url.pathname = `/${name}`;
  await promisify(execFile)(join(pkgDir, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
    cwd: pkgDir,
    env: { ...process.env, DATABASE_URL: url.toString() },
  });
  const clients: PrismaClient[] = [];
  return {
    url: url.toString(),
    client(maxConnections = 20) {
      const c = createPrismaClient(url.toString(), { maxConnections });
      clients.push(c);
      return c;
    },
    async drop() {
      await Promise.all(clients.map((c) => c.$disconnect()));
      await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await adminClient.$disconnect();
    },
  };
}
