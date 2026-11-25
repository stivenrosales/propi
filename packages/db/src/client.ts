// Prisma Client over node-postgres through the Prisma 7 driver adapter.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

export { Prisma, PrismaClient } from "../generated/prisma/client.ts";

export interface ClientOptions {
  /** Pool size. Each unit of work holds one connection while it waits on its advisory locks. */
  readonly maxConnections?: number;
}

export function createPrismaClient(connectionString: string, opts: ClientOptions = {}): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: opts.maxConnections ?? 20 });
  return new PrismaClient({ adapter });
}
