// The web composition root (architecture §2.3): one Prisma client, the Postgres ports, createApp with
// every handler, and the read-side queries. Pages, server actions and route handlers only call this;
// every write goes through `app.execute` (S106).
import {
  boardQueries,
  createApiTokens,
  createApp,
  createIdentities,
  engagementHandlers,
  insightsQueries,
  nodeCrypto,
  privacyQueries,
  type App,
  type BoardQueries,
  type Identities,
  type InsightsQueries,
  type Ports,
  type PrivacyQueries,
  type ShopReader,
  type WorkspaceId,
  type ApiTokens,
  type ApiHttp,
  createApiHttp,
} from "@propi/app";
import {
  createDbAdmin,
  createDbApiStores,
  createDbEngagementStores,
  createDbIdentityStore,
  createDbInsights,
  createDbInstallations,
  createDbPorts,
  createPrismaClient,
  secretCipherFromEnv,
  systemClock,
  uuidv7Ids,
  type DbAdmin,
  type DbApiStores,
  type DbEngagementStores,
  type DbInsights,
  type DbInstallations,
  type PrismaClient,
  createDbBilling,
} from "@propi/db";
import { apiReaders } from "./api-readers";
import { databaseUrl, polarConfig } from "./env";

export interface Propi {
  readonly prisma: PrismaClient;
  readonly ports: Ports;
  readonly app: App;
  readonly engagement: DbEngagementStores;
  readonly insights: DbInsights;
  readonly boards: BoardQueries;
  readonly metrics: InsightsQueries;
  readonly privacy: PrivacyQueries;
  readonly identities: Identities;
  /** Configuration that has no domain command yet (settings, roles, values): the db admin port. */
  readonly admin: DbAdmin;
  /** S47-S59 reads: the workspace reader is a ShopReader in the Postgres adapter. */
  shop(ws: WorkspaceId): ShopReader;
  /** Needs ENCRYPTION_KEY; created on first use so pages that do not need it keep working without it. */
  apiStores(): DbApiStores;
  tokens(): ApiTokens;
  /** The REST API (S97-S100): createApiHttp with every module's reads wired. */
  apiHttp(): ApiHttp;
  installations(): DbInstallations;
}

function build(): Propi {
  const prisma = createPrismaClient(databaseUrl(), { maxConnections: 10 });
  const ports = createDbPorts(prisma, { clock: systemClock, ids: uuidv7Ids });
  const engagement = createDbEngagementStores(prisma);
  // S7: the Free plan limit applies only when Polar billing is configured.
  const app = createApp(ports, {
    handlers: engagementHandlers({ reader: ports.reader, directory: ports.directory, ...engagement }),
    ...(polarConfig() === null ? {} : { billing: createDbBilling(prisma) }),
  });
  const insights = createDbInsights(prisma);
  const deps = { ports, source: insights.source };
  const identities = createIdentities({ store: createDbIdentityStore(prisma), directory: ports.directory });

  let api: DbApiStores | undefined;
  let tokens: ApiTokens | undefined;
  let installs: DbInstallations | undefined;
  let http: ApiHttp | undefined;
  const apiStores = () => (api ??= createDbApiStores(prisma, { cipher: secretCipherFromEnv() }));

  const shop = (ws: WorkspaceId) => ports.reader.workspace(ws) as unknown as ShopReader;
  const tokensOf = () => (tokens ??= createApiTokens({ store: apiStores().tokens, crypto: nodeCrypto, clock: systemClock, ids: uuidv7Ids }));

  return {
    prisma,
    ports,
    app,
    engagement,
    insights,
    boards: boardQueries(deps),
    metrics: insightsQueries(deps),
    privacy: privacyQueries(deps),
    identities,
    admin: createDbAdmin(prisma),
    shop,
    apiStores,
    tokens: tokensOf,
    apiHttp: () =>
      (http ??= createApiHttp({
        app,
        tokens: tokensOf(),
        directory: ports.directory,
        reader: ports.reader,
        readers: apiReaders({
          gifts: (ws) => insights.source.gifts(ws),
          shop,
          quests: engagement.quests,
          leaderboard: (ws, q) => insights.leaderboard(ws, q, systemClock.now()),
        }),
      })),
    installations: () => (installs ??= createDbInstallations(prisma, { cipher: secretCipherFromEnv() })),
  };
}

// One instance per server process (kept across dev hot reloads).
const holder = globalThis as unknown as { __propi?: Propi };

export function propi(): Propi {
  return (holder.__propi ??= build());
}
