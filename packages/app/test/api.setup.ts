// Shared setup for the API use-case tests: the app over in-memory ports plus the API stores.
import { type ApiTokenId, type CommandBase, type CommandKey, type Instant, type MemberId, type PosInt } from "@propi/core";
import { createApp } from "../src/index.ts";
import { createApiHttp, createApiTokens, createIdentities, createWebhookRelay, nodeCrypto, type ApiReadHandler } from "../src/api/index.ts";
import { createMemoryIdentityStore } from "../src/testing/identity.ts";
import { createMemoryApiStores } from "../src/testing/api.ts";
import { T0, WS, admin, setup } from "./setup.ts";

/** The shop commands the API maps writes to (S97). They run through the registered shop handlers. */
const SHOP_API_COMMANDS = new Set(["TransitionRedemption", "CreateReward", "UpdateReward", "SetRewardStatus"]);

export function apiSetup(opts: { readers?: Readonly<Record<string, ApiReadHandler>> } = {}) {
  const base = setup();
  const { mem } = base;
  const app = createApp(mem.ports);
  const stores = createMemoryApiStores(mem);
  const tokens = createApiTokens({ store: stores.tokens, crypto: nodeCrypto, clock: mem.ports.clock, ids: mem.ports.ids });
  const http = createApiHttp({ app, tokens, directory: mem.ports.directory, reader: mem.ports.reader, ...(opts.readers ? { readers: opts.readers } : {}) });
  const relay = createWebhookRelay({ outbox: stores.outbox, endpoints: stores.endpoints, deliveries: stores.deliveries, transport: stores.transport, crypto: nodeCrypto, clock: mem.ports.clock });

  const identities = createIdentities({ store: createMemoryIdentityStore(), directory: mem.ports.directory });

  async function issue(scopes: string[], name = "erp") {
    const r = await tokens.issue(admin, WS, { name, scopes });
    if (!r.ok) throw new Error(`issue failed: ${JSON.stringify(r.error)}`);
    return { token: r.value.token, id: r.value.view.id as ApiTokenId };
  }

  const call = (token: string | null, method: string, path: string, body?: unknown, idem?: string) =>
    http.handle({
      method,
      path,
      headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), ...(idem === undefined ? {} : { "Idempotency-Key": idem }) },
      body,
    });

  return {
    ...base,
    clock: mem.clock,
    app,
    stores,
    tokens,
    http,
    relay,
    identities,
    issue,
    call,
    /** What the API handed to the shop, read back from the command log (accepted or refused). */
    get captured(): (CommandBase & { readonly type: string })[] {
      return mem
        .commandLog(WS)
        .filter((r) => r.actor.kind === "apiToken")
        .map((r) => r.command as CommandBase & { readonly type: string })
        .filter((c) => SHOP_API_COMMANDS.has(c.type));
    },
  };
}

export { T0, WS, admin };

/** A pending redemption of a 10-unit reward by ana (manual approval), made through the real shop handlers. */
export async function pendingRedemption(s: ReturnType<typeof apiSetup>): Promise<string> {
  const base = (k: string) => ({ key: `test:${k}` as CommandKey, workspaceId: WS, actor: admin, at: T0 });
  const reward = await s.app.execute({
    ...base("reward"),
    type: "CreateReward",
    reward: { title: "Mug", description: "", image: null, cost: 10, stock: null, variants: [], categories: [], internalCost: null, instructions: "", autoApprove: false, giftCard: false },
  });
  if (!reward.ok) throw new Error(JSON.stringify(reward.error));
  await s.app.execute({ ...base("activate"), type: "SetRewardStatus", rewardId: reward.value.rewardId, status: "active" });
  await s.app.execute({ ...base("fund"), type: "GrantBonus", memberIds: ["ana" as MemberId], amount: 10 as PosInt, reason: "fund" });
  const ana = { kind: "member", memberId: "ana" as MemberId, role: "member" } as const;
  const r = await s.app.execute({ ...base("redeem"), actor: ana, type: "Redeem", memberId: "ana" as MemberId, rewardId: reward.value.rewardId, variantId: null });
  if (!r.ok || r.value.state !== "pending") throw new Error(JSON.stringify(r));
  return r.value.redemptionId;
}
export const at = (ms: number) => ms as Instant;
