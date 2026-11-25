// Health-only mode: without SLACK_BOT_TOKEN the server still serves /healthz, so a fresh deploy that
// waits for the Slack app's tokens stays up instead of restart-looping (S-SAFETY: tokens come later).
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { describeConfig, loadConfig } from "../src/config.ts";
import { healthRoute, startHealthServer, type HealthState } from "../src/health.ts";
import { hasDatabase, DATABASE_URL } from "./pg.ts";

const MAIN = join(import.meta.dirname, "..", "src", "main.ts");

describe("config without Slack tokens", () => {
  test("S-SAFETY: no Slack token at all gives slack: null instead of a ConfigError", () => {
    const c = loadConfig({ DATABASE_URL: "postgresql://x" });
    expect(c.slack).toBeNull();
    expect(describeConfig(c)).toMatchObject({ slackMode: "not_configured" });
  });
  test("S4: SLACK_BOT_TOKEN is optional; the app-level token alone serves every installation", () => {
    expect(loadConfig({ DATABASE_URL: "postgresql://x", SLACK_BOT_TOKEN: "  ", SLACK_APP_TOKEN: "xapp-synthetic" }).slack).toMatchObject({ mode: "socket", botToken: null, appToken: "xapp-synthetic" });
    expect(loadConfig({ DATABASE_URL: "postgresql://x", SLACK_SOCKET_MODE: "false", SLACK_SIGNING_SECRET: "s" }).slack).toMatchObject({ mode: "http", botToken: null });
  });
  test("a bot token without the Socket Mode app token is still an error", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgresql://x", SLACK_BOT_TOKEN: "xoxb-synthetic" })).toThrow(/SLACK_APP_TOKEN is required/);
  });
  test("DATABASE_URL is still required", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL is required/);
  });
});

async function get(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body };
}

describe("/healthz", () => {
  const servers: { close(cb: () => void): void }[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  });

  const serveWith = async (state: HealthState, pingDb: () => Promise<void>) => {
    const server = await startHealthServer(0, healthRoute(state, pingDb, 200));
    servers.push(server);
    return (server.address() as AddressInfo).port;
  };

  test("200 with slack not_configured when Postgres answers; 404 elsewhere", async () => {
    const port = await serveWith({ slack: "not_configured", lastLoopError: null }, async () => undefined);
    expect(await get(port, "/healthz")).toEqual({ status: 200, body: { ok: true, db: "ok", slack: "not_configured", lastLoopError: null } });
    expect((await get(port, "/slack/events")).status).toBe(404);
  });
  test("503 while Slack is starting, or when Postgres does not answer", async () => {
    const starting = await serveWith({ slack: "starting", lastLoopError: null }, async () => undefined);
    expect(await get(starting, "/healthz")).toMatchObject({ status: 503, body: { ok: false, slack: "starting" } });
    const noDb = await serveWith({ slack: "not_configured", lastLoopError: null }, () => Promise.reject(new Error("connection refused")));
    expect(await get(noDb, "/healthz")).toMatchObject({ status: 503, body: { ok: false, db: "connection refused", slack: "not_configured" } });
  });
});

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** Starts `propi-server serve` with only the given env (no Slack tokens) and polls /healthz. */
async function serveWithoutSlack(databaseUrl: string): Promise<{ child: ChildProcess; port: number; stdout: () => string; health: { status: number; body: unknown } }> {
  const port = await freePort();
  const child = spawn(process.execPath, [MAIN, "serve"], { env: { PATH: process.env["PATH"] ?? "", DATABASE_URL: databaseUrl, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout?.on("data", (b: Buffer) => (out += b.toString()));
  child.stderr?.on("data", (b: Buffer) => (out += b.toString()));
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`propi-server exited ${child.exitCode}: ${out}`);
    try {
      return { child, port, stdout: () => out, health: await get(port, "/healthz") };
    } catch {
      if (Date.now() > deadline) throw new Error(`no /healthz after 15 s: ${out}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function stop(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  child.kill("SIGTERM");
  return exited;
}

describe("propi-server serve without Slack tokens", () => {
  test("S-SAFETY: it stays up, says so, and answers /healthz (503 only because Postgres is unreachable)", async () => {
    const s = await serveWithoutSlack("postgresql://propi:propi@127.0.0.1:1/propi");
    try {
      expect(s.health).toMatchObject({ status: 503, body: { ok: false, slack: "not_configured" } });
      expect(s.stdout()).toContain("Slack not configured: set SLACK_APP_TOKEN (Socket Mode) or SLACK_SIGNING_SECRET (HTTP); running health only");
      expect(s.stdout()).not.toContain("is required");
    } finally {
      expect(await stop(s.child)).toBe(0);
    }
  }, 30_000);

  test.skipIf(!hasDatabase)("S-SAFETY: /healthz is 200 when Postgres answers, so the swarm healthcheck passes", async () => {
    const s = await serveWithoutSlack(DATABASE_URL!);
    try {
      expect(s.health).toEqual({ status: 200, body: { ok: true, db: "ok", slack: "not_configured", lastLoopError: null } });
    } finally {
      expect(await stop(s.child)).toBe(0);
    }
  }, 30_000);
});
