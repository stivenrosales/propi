#!/usr/bin/env node
// propi-server: the long-running process (Bolt receiver + outbox relay + scheduler, architecture
// §2.4) and the HeyTaco import into Postgres. Node 24 runs the TypeScript directly.
//   node apps/server/src/main.ts            serve (default)
//   node apps/server/src/main.ts import <dir> --team <T…> [--until <ts>]
import { createPrismaClient, secretCipherFromEnv } from "@propi/db";
import bolt from "@slack/bolt";
import { createBoltApp } from "./bolt.ts";
import { ConfigError, describeConfig, loadConfig } from "./config.ts";
import { healthRoute, startHealthServer, type HealthState } from "./health.ts";
import { IMPORT_USAGE, ImportUsageError, importIntoWorkspace, parseImportArgs } from "./import.ts";
import { ensureInstalled } from "./install.ts";
import { createSlackLookup } from "./lookup.ts";
import { relayOnce, webhookRelay } from "./relay.ts";
import { createRuntime } from "./runtime.ts";
import { createScheduler } from "./scheduler.ts";
import { webSlackApi } from "./slack-api.ts";
import { openRouterSummarizer } from "./summarizer.ts";

const log = (msg: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...data }));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function importMain(argv: readonly string[]): Promise<number> {
  let args: ReturnType<typeof parseImportArgs>;
  try {
    args = parseImportArgs(argv);
  } catch (e) {
    if (!(e instanceof ImportUsageError)) throw e;
    console.error(`propi-server: ${e.message}\n\n${IMPORT_USAGE}`);
    return 2;
  }
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    console.error("propi-server: DATABASE_URL is required");
    return 2;
  }
  const prisma = createPrismaClient(url);
  try {
    const rt = createRuntime(prisma, { cipher: secretCipherFromEnv() });
    const { ok, report } = await importIntoWorkspace(rt, args);
    console.log(JSON.stringify(report, null, 2));
    return ok ? 0 : 1;
  } catch (e) {
    console.error(`propi-server: ${errText(e)}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

/** Runs `f` every `everyMs`, never overlapping itself; errors are logged and the loop goes on. */
function loop(name: string, everyMs: number, f: () => Promise<void>, state: HealthState): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  const step = async () => {
    if (stopped) return;
    running = f().then(
      () => void (state.lastLoopError = null),
      (e) => {
        state.lastLoopError = `${name}: ${errText(e)}`;
        log(`${name} failed`, { error: errText(e) });
      },
    );
    await running;
    if (!stopped) setTimeout(step, everyMs).unref();
  };
  setTimeout(step, 0).unref();
  return async () => {
    stopped = true;
    await running;
  };
}

/** Resolves on SIGTERM or SIGINT. */
function untilSignal(): Promise<void> {
  return new Promise<void>((resolve) => {
    const stop = (signal: string) => {
      log("stopping", { signal });
      resolve();
    };
    process.once("SIGTERM", () => stop("SIGTERM"));
    process.once("SIGINT", () => stop("SIGINT"));
  });
}

async function serve(): Promise<number> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`propi-server: ${e.message} (see deploy/propi.env.example)`);
      return 2;
    }
    throw e;
  }
  log("starting", describeConfig(config));
  const prisma = createPrismaClient(config.databaseUrl);
  const pingDb = async () => void (await prisma.$queryRaw`SELECT 1`);
  const slackConfig = config.slack;
  if (slackConfig === null) {
    // The Slack app is created after the first deploy: stay up for the healthcheck until its tokens exist.
    log("Slack not configured: set SLACK_BOT_TOKEN/SLACK_APP_TOKEN; running health only", { port: config.port });
    const server = await startHealthServer(config.port, healthRoute({ slack: "not_configured", lastLoopError: null }, pingDb));
    await untilSignal();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    return 0;
  }
  const summarizer = config.openRouter === null ? null : openRouterSummarizer(config.openRouter);
  const rt = createRuntime(prisma, { cipher: secretCipherFromEnv(), summarizer });
  const slack = webSlackApi(new bolt.webApi.WebClient(slackConfig.botToken));
  const lookup = createSlackLookup(rt, slack, (m, d) => log(m, d as Record<string, unknown>));

  const { teamId } = await slack.authTest();
  const install = await ensureInstalled(rt, { teamId, installerUserId: slackConfig.installerUserId, timezone: config.timezone, now: rt.ports.clock.now() });
  log("workspace ready", { created: install.created, reinstalled: install.reinstalled });
  const workspaces = async () => {
    const ws = await lookup.workspace(teamId);
    return ws === null ? [] : [ws];
  };

  const health: HealthState = { slack: "starting", lastLoopError: null };
  const deps = { rt, lookup, slack, appUrl: config.appUrl, log };
  const app = createBoltApp({ slack: slackConfig, port: config.port }, deps, [healthRoute(health, pingDb)]);
  await app.start(config.port);
  health.slack = "ready";
  log("slack connected", { mode: slackConfig.mode, port: config.port });

  const webhooks = webhookRelay(rt);
  const stopRelay = loop(
    "relay",
    config.relayIntervalMs,
    async () => {
      const pass = await relayOnce(deps);
      if (pass.slackEvents + pass.questEvents > 0) log("relay", { ...pass });
      for (const ws of await workspaces()) {
        const w = await webhooks.tick(ws);
        if (w.attempted > 0) log("webhooks", { ...w });
      }
    },
    health,
  );
  const scheduler = createScheduler({ rt, workspaces, log });
  const stopScheduler = config.schedulerEnabled
    ? loop(
        "scheduler",
        60_000,
        async () => {
          const r = await scheduler.tick();
          if (Object.keys(r.ran).length > 0 || r.errors > 0) log("scheduler", { ...r });
        },
        health,
      )
    : async () => undefined;

  await untilSignal();
  health.slack = "starting";
  await Promise.allSettled([app.stop(), stopRelay(), stopScheduler()]);
  await prisma.$disconnect();
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "--help" || command === "-h" || command === "help") {
  console.log(`usage: propi-server [serve]\n       ${IMPORT_USAGE.replace(/^usage: /, "")}`);
} else if (command === "import") {
  process.exitCode = await importMain(rest);
} else if (command === undefined || command === "serve") {
  process.exitCode = await serve();
} else {
  console.error(`propi-server: unknown command ${command}`);
  process.exitCode = 2;
}
