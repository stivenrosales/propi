// Port contract for the API stores (S98, S99): tokens, webhook endpoints, deliveries and the outbox.
// The same scenario runs through createApp + createApiTokens + createWebhookRelay over the in-memory
// stores (app/testing/api.ts) and over Postgres, and both must answer the same. Postgres-only
// properties (encryption at rest, SKIP LOCKED claiming, final revocations) are pinned below.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createApiTokens,
  createApp,
  createWebhookRelay,
  defaultSettings,
  nodeCrypto,
  webhookEventId,
  type ApiTokenId,
  type ApiTokenStore,
  type CommandKey,
  type Crypto,
  type DeliveryStore,
  type Instant,
  type OutboxReader,
  type PosInt,
  type Ports,
  type WebhookEndpoint,
  type WebhookRequest,
  type WorkspaceId,
  verifyWebhook,
} from "@propi/app";
import { createMemoryApiStores, createMemoryPorts } from "@propi/app/testing";
import { createDbAdmin, createDbApiStores, createDbPorts, createSecretCipher, type DbApiStores, type PrismaClient } from "../src/index.ts";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./pg.ts";
import { T0, admin, key, m, memberActor, mention, msg } from "./harness.ts";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const cipher = createSecretCipher(KEY);

let db: TestDatabase | undefined;
let pg: PrismaClient | undefined;

beforeAll(async () => {
  if (hasDatabase) {
    db = await createTestDatabase();
    pg = db.client();
  }
}, 120_000);
afterAll(async () => {
  await db?.drop();
});

/** Deterministic token secrets so both backends store the same hash. */
function testCrypto(): Crypto {
  let k = 0;
  return { ...nodeCrypto, randomToken: () => `secret${++k}` };
}

interface World {
  readonly ws: WorkspaceId;
  readonly ports: Ports;
  readonly tokens: ApiTokenStore;
  readonly deliveries: DeliveryStore;
  readonly outbox: OutboxReader;
  addEndpoint(e: WebhookEndpoint): Promise<void>;
  readonly endpoints: { list(ws: WorkspaceId): Promise<readonly WebhookEndpoint[]> };
  setNow(ms: number): void;
}

const PEOPLE = ["giver", "ana", "bob"];

async function memoryWorld(ws: WorkspaceId): Promise<World> {
  const mem = createMemoryPorts({ now: T0 });
  mem.addWorkspace(ws, defaultSettings({ timezone: "America/Lima" }));
  for (const id of PEOPLE) mem.addMember(ws, { id: m(id), role: "member", active: true, dailyLimitOverride: null });
  mem.addMember(ws, { id: m("boss"), role: "admin", active: true, dailyLimitOverride: null });
  const stores = createMemoryApiStores(mem);
  return {
    ws,
    ports: mem.ports,
    tokens: stores.tokens,
    deliveries: stores.deliveries,
    outbox: stores.outbox,
    endpoints: stores.endpoints,
    addEndpoint: async (e) => stores.endpoints.add(e),
    setNow: (ms) => mem.clock.set(ms),
  };
}

async function postgresWorld(ws: WorkspaceId, idPrefix = ""): Promise<World & { readonly stores: DbApiStores }> {
  if (pg === undefined) throw new Error("no database");
  let now = T0 as number;
  let n = 0;
  const ports = createDbPorts(pg, { clock: { now: () => now as Instant }, ids: { next: (kind) => `${idPrefix}${kind}-${++n}` } });
  const dbAdmin = createDbAdmin(pg);
  await dbAdmin.addWorkspace(ws, defaultSettings({ timezone: "America/Lima" }));
  for (const id of PEOPLE) await dbAdmin.addMember(ws, { id: m(id), role: "member", active: true, dailyLimitOverride: null });
  await dbAdmin.addMember(ws, { id: m("boss"), role: "admin", active: true, dailyLimitOverride: null });
  const stores = createDbApiStores(pg, { cipher });
  return {
    ws,
    ports,
    stores,
    tokens: stores.tokens,
    deliveries: stores.deliveries,
    outbox: stores.outbox,
    endpoints: stores.endpoints,
    addEndpoint: (e) => stores.endpoints.save(e),
    setNow: (ms) => void (now = ms),
  };
}

const SECRETS: Record<string, string> = { "https://erp.example/hooks": "whsec_all", "https://flaky.example/hooks": "whsec_gifts" };

let wsN = 0;
const nextWs = () => `ws-api-${process.pid}-${++wsN}` as WorkspaceId;

/** S98 + S99 end to end: issue, revoke, authenticate; then gifts → outbox → signed deliveries with retries. */
async function scenario(w: World) {
  const app = createApp(w.ports);
  const tokens = createApiTokens({ store: w.tokens, crypto: testCrypto(), clock: w.ports.clock, ids: w.ports.ids });
  const erp = await tokens.issue(admin, w.ws, { name: "erp", scopes: ["ledger:read", "members:read"] });
  const old = await tokens.issue(admin, w.ws, { name: "old", scopes: ["adjustments:write"] });
  if (!erp.ok || !old.ok) throw new Error("issue failed");
  w.setNow(T0 + 1000);
  const revoked = await tokens.revoke(admin, w.ws, old.value.view.id);
  const revokedTwice = await tokens.revoke(admin, w.ws, old.value.view.id);
  const auth = {
    ok: await tokens.authenticate(`Bearer ${erp.value.token}`),
    revoked: await tokens.authenticate(`Bearer ${old.value.token}`),
    wrongSecret: await tokens.authenticate(`Bearer ${erp.value.token}x`),
    unknown: await tokens.authenticate("Bearer propi_nope.secret"),
    missing: await tokens.authenticate(undefined),
  };
  const listed = await tokens.list(w.ws);

  await w.addEndpoint({ id: "ep-all", workspaceId: w.ws, url: "https://erp.example/hooks", secret: "whsec_all", events: "*", active: true });
  await w.addEndpoint({ id: "ep-gifts", workspaceId: w.ws, url: "https://flaky.example/hooks", secret: "whsec_gifts", events: ["gift.given"], active: true });
  await w.addEndpoint({ id: "ep-off", workspaceId: w.ws, url: "https://off.example/hooks", secret: "whsec_off", events: "*", active: false });

  w.setNow(T0);
  const give = (from: string, to: string, ref: string) =>
    app.execute({ type: "GiveByMessage", key: key(`slack:msg:${ref}`), workspaceId: w.ws, actor: memberActor(from), at: T0, messageRef: ref, message: msg(`@${to} thanks :taco:`, [mention(to)], 1) });
  await give("giver", "ana", "T:C1:1");
  await give("ana", "bob", "T:C1:2");
  await app.execute({ type: "GrantBonus", key: key("adm:1"), workspaceId: w.ws, actor: admin, at: T0, memberIds: [m("bob")], amount: 3 as PosInt, reason: "launch" });

  const requests: WebhookRequest[] = [];
  let flaky = true;
  const transport = {
    async post(req: WebhookRequest) {
      requests.push(req);
      if (req.url.startsWith("https://flaky") && flaky) return { status: 503 };
      return { status: 200 };
    },
  };
  const relay = createWebhookRelay({ outbox: w.outbox, endpoints: w.endpoints, deliveries: w.deliveries, transport, crypto: nodeCrypto, clock: w.ports.clock });
  const first = await relay.tick(w.ws);
  const again = await relay.tick(w.ws); // nothing due, nothing new
  w.setNow(T0 + 61_000);
  flaky = false;
  const retry = await relay.tick(w.ws);

  return {
    issued: [erp.value.view, old.value.view],
    revoked,
    revokedTwice,
    auth,
    listed,
    endpoints: await w.endpoints.list(w.ws),
    events: await w.outbox.events(w.ws),
    ticks: [first, again, retry],
    deliveries: await w.deliveries.list(w.ws),
    // JSONB stores the event payload with its own key order, so bodies are compared as JSON and
    // signatures by verifying them over the exact bytes that were sent.
    requests: requests.map((r) => ({
      url: r.url,
      eventId: r.headers["X-Propi-Event-Id"],
      body: JSON.parse(r.body) as unknown,
      signature: verifyWebhook(nodeCrypto, SECRETS[r.url]!, r.body, r.headers["X-Propi-Signature"]!, w.ports.clock.now()),
    })),
  };
}

describe("API stores contract (S98, S99)", () => {
  test("S98 S99: the memory stores run the scenario as specified", async () => {
    const r = await scenario(await memoryWorld(nextWs()));
    expect(r.revoked.ok).toBe(true);
    expect(r.revokedTwice).toEqual(r.revoked); // revoking again changes nothing
    expect(r.auth.ok.ok).toBe(true);
    expect(r.auth.revoked.ok).toBe(false);
    expect(r.ticks[0]).toEqual({ planned: 4, attempted: 4, delivered: 2, failed: 2, dead: 0 });
    expect(r.ticks[2]).toMatchObject({ attempted: 2, delivered: 2 });
    expect(r.requests.every((q) => q.signature.ok)).toBe(true);
  });

  test.skipIf(!hasDatabase)("S98 S99: Postgres answers exactly like the memory stores", async () => {
    const ws = nextWs();
    const mem = await scenario(await memoryWorld(ws));
    const sql = await scenario(await postgresWorld(ws));
    expect(sql).toEqual(mem);
  });
});

describe.skipIf(!hasDatabase)("API stores on Postgres", () => {
  let w: Awaited<ReturnType<typeof postgresWorld>>;
  beforeAll(async () => {
    w = await postgresWorld(nextWs(), "pg-");
  });

  test("S98: tokens are stored as a hash only, and a revocation is final", async () => {
    const tokens = createApiTokens({ store: w.tokens, crypto: nodeCrypto, clock: w.ports.clock, ids: w.ports.ids });
    const r = await tokens.issue(admin, w.ws, { name: "ci", scopes: ["members:read"] });
    if (!r.ok) throw new Error("issue failed");
    const [row] = await pg!.$queryRaw<{ secret_hash: string; scopes: string[] }[]>`SELECT secret_hash, scopes FROM api_token WHERE id = ${r.value.view.id}`;
    expect(row?.secret_hash).toBe(nodeCrypto.sha256Hex(r.value.token));
    expect(row?.scopes).toEqual(["members:read"]);

    const stored = await w.tokens.get(r.value.view.id);
    await w.tokens.save({ ...stored!, revokedAt: (T0 + 5) as Instant });
    await w.tokens.save({ ...stored!, revokedAt: null }); // a stale writer cannot un-revoke
    expect((await w.tokens.get(r.value.view.id))?.revokedAt).toBe(T0 + 5);
    await expect(w.tokens.save({ ...stored!, secretHash: "0".repeat(64) })).rejects.toThrow(/cannot change/);
    expect(await w.tokens.get("apiToken-missing" as ApiTokenId)).toBeNull();
  });

  test("S99: endpoint secrets are encrypted at rest and bound to their row", async () => {
    await w.stores.endpoints.save({ id: "ep-secret", workspaceId: w.ws, url: "https://x.example", secret: "whsec_plain", events: ["gift.given"], active: true });
    const [row] = await pg!.$queryRaw<{ secret_enc: string }[]>`SELECT secret_enc FROM webhook_endpoint WHERE id = 'ep-secret'`;
    expect(row?.secret_enc.startsWith("v1.")).toBe(true);
    expect(row?.secret_enc).not.toContain("whsec_plain");
    expect((await w.stores.endpoints.get(w.ws, "ep-secret"))?.secret).toBe("whsec_plain");

    // A ciphertext moved to another endpoint row does not decrypt there.
    await pg!.$executeRaw`
      INSERT INTO webhook_endpoint (workspace_id, id, url, secret_enc, events, active)
      VALUES (${w.ws}, 'ep-copy', 'https://y.example', ${row!.secret_enc}, '"*"'::jsonb, true)`;
    await expect(w.stores.endpoints.get(w.ws, "ep-copy")).rejects.toThrow();
    await pg!.$executeRaw`DELETE FROM webhook_endpoint WHERE id = 'ep-copy'`;
  });

  test("S99: the stored public event id equals core webhookEventId, non-ASCII keys included", async () => {
    const app = createApp(w.ports);
    const ref = "T:Cñ:ü-1";
    await app.execute({ type: "GiveByMessage", key: key(`slack:msg:${ref}`), workspaceId: w.ws, actor: memberActor("giver"), at: T0, messageRef: ref, message: msg("@ana :taco:", [mention("ana")], 1) });
    const rows = await pg!.$queryRaw<{ public_id: string; command_key: string; ordinal: number }[]>`
      SELECT public_id, command_key, ordinal FROM domain_event WHERE workspace_id = ${w.ws}`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.public_id).toBe(webhookEventId(w.ws, r.command_key as CommandKey, r.ordinal));
  });

  test("S99: claimDue leases each due delivery to one relay and returns it as stored", async () => {
    const events = await w.outbox.events(w.ws);
    const event = events[0]!;
    const ds = ["a", "b", "c"].map((ep) => ({
      id: `${event.id}|lease-${ep}`,
      workspaceId: w.ws,
      eventId: event.id,
      endpointId: `lease-${ep}`,
      status: "pending" as const,
      attempts: 0,
      nextAttemptAt: (T0 - 10) as Instant,
      lastError: null,
    }));
    await w.deliveries.insert(ds);
    await w.deliveries.insert(ds); // planned twice, stored once
    const [one, two] = await Promise.all([
      w.stores.deliveries.claimDue(T0, { workspaceId: w.ws, limit: 2, leaseMs: 30_000 }),
      w.stores.deliveries.claimDue(T0, { workspaceId: w.ws, limit: 2, leaseMs: 30_000 }),
    ]);
    const ids = [...one, ...two].map((d) => d.id).sort();
    expect(ids).toEqual(ds.map((d) => d.id).sort());
    expect([...one, ...two].every((d) => d.nextAttemptAt === T0 - 10)).toBe(true);
    expect(await w.stores.deliveries.claimDue((T0 + 1000) as Instant, { workspaceId: w.ws })).toEqual([]); // leased
    expect((await w.stores.deliveries.claimDue((T0 + 31_000) as Instant, { workspaceId: w.ws })).length).toBe(3); // lease expired

    // A terminal delivery never changes again, and a stale attempt count never wins.
    await w.deliveries.update({ ...ds[0]!, status: "done", attempts: 2 });
    await w.deliveries.update({ ...ds[0]!, status: "pending", attempts: 1 });
    await w.deliveries.update({ ...ds[1]!, attempts: 3, nextAttemptAt: (T0 + 99) as Instant, lastError: "http 500" });
    await w.deliveries.update({ ...ds[1]!, attempts: 1, lastError: "stale" });
    const after = new Map((await w.deliveries.list(w.ws)).map((d) => [d.id, d]));
    expect(after.get(ds[0]!.id)).toMatchObject({ status: "done", attempts: 2 });
    expect(after.get(ds[1]!.id)).toMatchObject({ status: "pending", attempts: 3, lastError: "http 500", nextAttemptAt: T0 + 99 });
  });

  test("outbox claimEvents: concurrent consumers get disjoint batches, each event is handled once", async () => {
    const app = createApp(w.ports);
    for (const ref of ["T:C9:1", "T:C9:2", "T:C9:3"]) {
      await app.execute({ type: "GiveByMessage", key: key(`slack:msg:${ref}`), workspaceId: w.ws, actor: memberActor("bob"), at: T0, messageRef: ref, message: msg("@ana :taco:", [mention("ana")], 1) });
    }
    const all = (await w.outbox.events(w.ws)).map((e) => e.id);
    const seen: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const slow = w.stores.outbox.claimEvents(
      "relay",
      async (events) => {
        seen.push(...events.map((e) => e.id));
        await held;
      },
      { workspaceId: w.ws, limit: 2 },
    );
    await new Promise((r) => setTimeout(r, 200));
    const fast = await w.stores.outbox.claimEvents("relay", async (events) => seen.push(...events.map((e) => e.id)), { workspaceId: w.ws, limit: 1000 });
    release();
    await slow;
    expect(fast.claimed).toBe(all.length - 2);
    expect([...seen].sort()).toEqual([...all].sort());
    expect((await w.stores.outbox.claimEvents("relay", async () => null, { workspaceId: w.ws })).claimed).toBe(0);

    // Another consumer has its own receipts; a failing handler records nothing.
    await expect(w.stores.outbox.claimEvents("notifier", async () => Promise.reject(new Error("boom")), { workspaceId: w.ws })).rejects.toThrow("boom");
    expect((await w.stores.outbox.claimEvents("notifier", async (events) => events.length, { workspaceId: w.ws })).result).toBe(all.length);
  });
});
