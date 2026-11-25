// Prisma CLI configuration (Prisma 7). The URL comes from DATABASE_URL; it is only
// required by commands that talk to the database (migrate deploy/status).
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env["DATABASE_URL"] ?? "postgresql://propi:propi@localhost:55433/propi" },
});
