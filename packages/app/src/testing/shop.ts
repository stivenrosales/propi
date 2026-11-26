// In-memory shop store for use-case tests. It wraps createMemoryPorts: the Tx and the
// lock-time reader gain the ShopReader reads, and commit applies shop writes (compare-and-set,
// conditional stock decrement) atomically with the ledger entries and events.
import { signedAmount, type Commit, type LedgerEntry, type MemberId, type Ports, type Tx, type WorkspaceId } from "@propi/core";
import {
  DEFAULT_SHOP_SETTINGS,
  budgetSpent,
  isShopWrite,
  prepaidReserved,
  redemptionQuantity,
  type Collab,
  type GiftCardProvider,
  type Money,
  type Redemption,
  type Reward,
  type ShopReader,
  type ShopSettings,
  type ShopWrite,
} from "../shop/core.ts";

/** S2: rows stored before batch redemption carry no quantity and read as one unit (as the Postgres adapter does). */
const withQuantity = (r: Redemption): Redemption => ({ ...r, quantity: redemptionQuantity(r) });

/** What the shop store wraps: memory ports plus a synchronous view of the ledger. */
export interface ShopStoreBase {
  readonly ports: Ports;
  entries(ws: WorkspaceId): readonly LedgerEntry[];
}

interface ShopState {
  settings: ShopSettings;
  readonly rewards: Map<string, Reward>;
  readonly redemptions: Map<string, Redemption>;
  readonly collabs: Map<string, Collab>;
}

const yieldNow = () => Promise.resolve();

/** Apply one write to the state; returns its undo. Throws (mutating nothing) when a CAS fails. */
function apply(s: ShopState, w: ShopWrite): () => void {
  switch (w.t) {
    case "shop.settings.put": {
      const prev = s.settings;
      s.settings = w.settings;
      return () => void (s.settings = prev);
    }
    case "shop.reward.insert": {
      if (s.rewards.has(w.reward.id)) throw new Error(`reward ${w.reward.id} already exists`);
      s.rewards.set(w.reward.id, w.reward);
      return () => void s.rewards.delete(w.reward.id);
    }
    case "shop.reward.status": {
      const prev = s.rewards.get(w.rewardId);
      if (prev?.status !== w.from) throw new Error(`reward ${w.rewardId} is not ${w.from}`);
      s.rewards.set(w.rewardId, { ...prev, status: w.to });
      return () => void s.rewards.set(w.rewardId, prev);
    }
    case "shop.reward.update": {
      const prev = s.rewards.get(w.reward.id);
      if (prev?.status !== w.from) throw new Error(`reward ${w.reward.id} is not ${w.from}`);
      s.rewards.set(w.reward.id, w.reward);
      return () => void s.rewards.set(w.reward.id, prev);
    }
    case "shop.stock.take":
    case "shop.stock.add": {
      const prev = s.rewards.get(w.rewardId);
      if (prev === undefined) throw new Error(`reward ${w.rewardId} not found`);
      const delta = w.t === "shop.stock.take" ? -(w.quantity ?? 1) : w.quantity;
      const bump = (stock: number | null): number | null => {
        if (stock === null) return null;
        if (stock + delta < 0) throw new Error(`reward ${w.rewardId} is out of stock`); // the conditional decrement
        return stock + delta;
      };
      const next: Reward =
        w.variantId === null
          ? { ...prev, stock: bump(prev.stock) }
          : { ...prev, variants: prev.variants.map((v) => (v.id === w.variantId ? { ...v, stock: bump(v.stock) } : v)) };
      s.rewards.set(w.rewardId, next);
      return () => void s.rewards.set(w.rewardId, prev);
    }
    case "shop.redemption.put": {
      const prev = s.redemptions.get(w.redemption.id);
      if ((prev?.state ?? null) !== w.from) throw new Error(`redemption ${w.redemption.id} is ${prev?.state ?? "missing"}, expected ${w.from ?? "missing"}`);
      s.redemptions.set(w.redemption.id, w.redemption);
      return () => void (prev === undefined ? s.redemptions.delete(w.redemption.id) : s.redemptions.set(w.redemption.id, prev));
    }
    case "shop.collab.put": {
      const prev = s.collabs.get(w.collab.id);
      if ((prev?.phase ?? null) !== w.from) throw new Error(`collab ${w.collab.id} is ${prev?.phase ?? "missing"}, expected ${w.from ?? "missing"}`);
      s.collabs.set(w.collab.id, w.collab);
      return () => void (prev === undefined ? s.collabs.delete(w.collab.id) : s.collabs.set(w.collab.id, prev));
    }
  }
}

export interface GiftCardFake extends GiftCardProvider {
  issued(): readonly { readonly key: string; readonly redemptionId: string; readonly value: Money }[];
}

/** S108: a provider with a prepaid balance; issuing is idempotent per key and refused when short. */
export function createGiftCardFake(prepaid: Money): GiftCardFake {
  const issued = new Map<string, { key: string; redemptionId: string; value: Money }>();
  const spent = () => [...issued.values()].reduce((t, i) => t + i.value.minor, 0);
  return {
    async prepaidBalance() {
      await yieldNow();
      return { minor: prepaid.minor - spent(), currency: prepaid.currency };
    },
    async issue(req) {
      await yieldNow();
      if (issued.has(req.key)) return { ok: true };
      if (prepaid.minor - spent() < req.value.minor) return { ok: false };
      issued.set(req.key, { key: req.key, redemptionId: req.redemptionId, value: req.value });
      return { ok: true };
    },
    issued: () => [...issued.values()],
  };
}

export interface ShopStoreOptions {
  readonly giftCards?: GiftCardProvider | null;
}

export function withShopStore(mem: ShopStoreBase, opts: ShopStoreOptions = {}) {
  const states = new Map<WorkspaceId, ShopState>();
  const state = (ws: WorkspaceId): ShopState => {
    let s = states.get(ws);
    if (!s) {
      s = { settings: DEFAULT_SHOP_SETTINGS, rewards: new Map(), redemptions: new Map(), collabs: new Map() };
      states.set(ws, s);
    }
    return s;
  };

  function reader(ws: WorkspaceId): ShopReader {
    const s = () => state(ws);
    return {
      async shopSettings() {
        await yieldNow();
        return s().settings;
      },
      async reward(id) {
        await yieldNow();
        return s().rewards.get(id) ?? null;
      },
      async rewards() {
        await yieldNow();
        return [...s().rewards.values()];
      },
      async redemption(id) {
        await yieldNow();
        const r = s().redemptions.get(id);
        return r === undefined ? null : withQuantity(r);
      },
      async redemptions() {
        await yieldNow();
        return [...s().redemptions.values()].map(withQuantity);
      },
      async budgetSpent(month) {
        await yieldNow();
        return budgetSpent(s().redemptions.values(), month);
      },
      async prepaidAvailable() {
        if (!opts.giftCards) return null;
        const balance = await opts.giftCards.prepaidBalance(ws);
        return { minor: balance.minor - prepaidReserved(s().redemptions.values()), currency: balance.currency };
      },
      async collab(id) {
        await yieldNow();
        return s().collabs.get(id) ?? null;
      },
      async contributions(id) {
        await yieldNow();
        const out = new Map<MemberId, number>();
        for (const e of mem.entries(ws)) {
          if (e.cause.type !== "contribution" || e.cause.collabId !== id) continue;
          out.set(e.memberId, (out.get(e.memberId) ?? 0) - signedAmount(e)); // spend adds, refund removes
        }
        return out;
      },
    };
  }

  function extend(ws: WorkspaceId, tx: Tx): Tx & ShopReader {
    return {
      ...tx,
      ...reader(ws),
      async commit<T>(c: Commit<T>) {
        const shopWrites = c.decision.writes.filter(isShopWrite) as unknown as ShopWrite[];
        const rest = c.decision.writes.filter((w) => !isShopWrite(w));
        // Apply the shop writes synchronously (all or none), then the ledger commit; undo on failure.
        const undo: (() => void)[] = [];
        try {
          for (const w of shopWrites) undo.push(apply(state(ws), w));
        } catch (err) {
          for (const u of undo.reverse()) u();
          throw err;
        }
        try {
          await tx.commit({ ...c, decision: { ...c.decision, writes: rest } });
        } catch (err) {
          for (const u of undo.reverse()) u();
          throw err;
        }
      },
    };
  }

  const ports: Ports = {
    ...mem.ports,
    uow: { run: (ws, locks, fn) => mem.ports.uow.run(ws, locks, (tx) => fn(extend(ws, tx))) },
    reader: { workspace: (ws) => ({ ...mem.ports.reader.workspace(ws), ...reader(ws) }) },
  };

  return {
    ports,
    reader,
    /** A synchronous snapshot for assertions. */
    state: (ws: WorkspaceId) => {
      const s = state(ws);
      return { settings: s.settings, rewards: [...s.rewards.values()], redemptions: [...s.redemptions.values()], collabs: [...s.collabs.values()] };
    },
  };
}

export type ShopStore = ReturnType<typeof withShopStore>;
