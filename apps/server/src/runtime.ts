// The composition root: Postgres ports (packages/db) + createApp with every module's handlers.
// All writes go through app.execute (S106); this file only wires.
import {
  boardQueries,
  createApp,
  createIdentities,
  engagementHandlers,
  insightsQueries,
  notifyQueries,
  type App,
  type BoardQueries,
  type Clock,
  type Identities,
  type Ids,
  type InsightsDeps,
  type InsightsQueries,
  type NotifyQueries,
  type Ports,
} from "@propi/app";
import type { IdentityStore } from "@propi/core";
import type { Summarizer } from "@propi/core/insights";
import {
  createDbAdmin,
  createDbApiStores,
  createDbEngagementStores,
  createDbIdentityStore,
  createDbInsights,
  createDbInstallations,
  createDbPorts,
  type DbAdmin,
  type DbApiStores,
  type DbEngagementStores,
  type DbInsights,
  type DbInstallations,
  type PrismaClient,
  type SecretCipher,
} from "@propi/db";
import { jobHandlers } from "./jobs.ts";

export interface RuntimeOptions {
  readonly cipher: SecretCipher;
  readonly clock?: Clock;
  readonly ids?: Ids;
  /** S91: only when OPENROUTER_API_KEY is set. */
  readonly summarizer?: Summarizer | null;
}

export interface Runtime {
  readonly prisma: PrismaClient;
  readonly ports: Ports;
  readonly app: App;
  readonly admin: DbAdmin;
  readonly identityStore: IdentityStore;
  readonly identities: Identities;
  readonly installations: DbInstallations;
  readonly insights: DbInsights;
  readonly engagement: DbEngagementStores;
  readonly api: DbApiStores;
  readonly insightsDeps: InsightsDeps;
  readonly boards: BoardQueries;
  readonly notify: NotifyQueries;
  readonly insightsQueries: InsightsQueries;
  readonly summarizer: Summarizer | null;
}

export function createRuntime(prisma: PrismaClient, opts: RuntimeOptions): Runtime {
  const ports = createDbPorts(prisma, { ...(opts.clock === undefined ? {} : { clock: opts.clock }), ...(opts.ids === undefined ? {} : { ids: opts.ids }) });
  const engagement = createDbEngagementStores(prisma);
  const app = createApp(ports, { handlers: [...engagementHandlers({ reader: ports.reader, directory: ports.directory, ...engagement }), ...jobHandlers] });
  const identityStore = createDbIdentityStore(prisma);
  const insights = createDbInsights(prisma);
  const summarizer = opts.summarizer ?? null;
  const insightsDeps: InsightsDeps = { ports, source: insights.source, ...(summarizer === null ? {} : { summarizer }) };
  return {
    prisma,
    ports,
    app,
    admin: createDbAdmin(prisma),
    identityStore,
    identities: createIdentities({ store: identityStore, directory: ports.directory }),
    installations: createDbInstallations(prisma, { cipher: opts.cipher, ...(opts.ids === undefined ? {} : { ids: opts.ids }) }),
    insights,
    engagement,
    api: createDbApiStores(prisma, { cipher: opts.cipher }),
    insightsDeps,
    boards: boardQueries(insightsDeps),
    notify: notifyQueries(insightsDeps),
    insightsQueries: insightsQueries(insightsDeps),
    summarizer,
  };
}
