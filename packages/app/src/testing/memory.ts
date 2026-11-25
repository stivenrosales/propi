// In-memory implementations of every port. A mutex per lock key stands in for
// pg_advisory_xact_lock, and a Map stands in for command_log (architecture §1.6, §2.2).
// Every read yields to the event loop so unsynchronized code would actually interleave.
import {
  allowanceUsed,
  netPerReceiver,
  orderLocks,
  signedAmount,
  type Claim,
  type CommandKey,
  type CommandLogRecord,
  type Commit,
  type DomainEvent,
  type Gift,
  type GiftId,
  type Instant,
  type LedgerEntry,
  type LedgerReader,
  type LockKey,
  type MemberId,
  type MemberRecord,
  type Ports,
  type StateWrite,
  type Tx,
  type Value,
  type WorkspaceId,
  type WorkspaceReader,
  type WorkspaceSettings,
} from "@propi/core";
import { withShopStore, type ShopStoreOptions } from "./shop.ts";

export interface EventRecord {
  readonly seq: number;
  readonly workspaceId: WorkspaceId;
  readonly commandKey: CommandKey;
  readonly ordinal: number;
  readonly at: Instant;
  readonly event: DomainEvent;
}

type LogRow =
  | { readonly status: "running"; readonly requestHash: string; readonly settled: Promise<void>; readonly settle: () => void }
  | { readonly status: "done"; readonly record: CommandLogRecord };

interface WorkspaceState {
  settings: WorkspaceSettings;
  readonly members: Map<MemberId, MemberRecord>;
  values: readonly Value[];
  readonly entries: LedgerEntry[];
  readonly gifts: Map<GiftId, Gift>;
  readonly log: Map<CommandKey, LogRow>;
  readonly events: EventRecord[];
}

export interface MemoryOptions extends ShopStoreOptions {
  readonly now?: number;
  /** false disables the per-key mutex, to show that the race the locks prevent is real. */
  readonly locking?: boolean;
}

const yieldNow = () => Promise.resolve();

/** A FIFO mutex per key. */
class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => held);
    this.tails.set(key, tail);
    await prev;
    return () => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
      release();
    };
  }
}

/** Write appliers: prepare (may throw, mutates nothing) then apply. One entry per StateWrite kind. */
const WRITE_APPLIERS: { readonly [K in StateWrite["t"]]: (s: WorkspaceState, w: Extract<StateWrite, { t: K }>) => () => void } = {
  "gift.upsert": (s, w) => () => void s.gifts.set(w.gift.id, w.gift),
};

function readerFor(s: WorkspaceState): WorkspaceReader {
  const sumWhere = (pred: (e: LedgerEntry) => boolean) => s.entries.reduce((t, e) => (pred(e) ? t + signedAmount(e) : t), 0);
  const isGiftKind = (e: LedgerEntry) => e.kind === "gift" || e.kind === "gift_reversal";
  const reactionGifts = (giver: MemberId, messageRef: string, emoji: string) =>
    [...s.gifts.values()].filter((g) => g.source === "reaction" && g.giver === giver && g.messageRef === messageRef && g.emoji === emoji);

  const reader: WorkspaceReader = {
    // SQL-shaped filtered sums (architecture §1.2), independent of core.replay so S34 compares two implementations.
    async balances(member) {
      await yieldNow();
      return {
        received: sumWhere((e) => e.memberId === member && isGiftKind(e)),
        given: sumWhere((e) => e.counterpartId === member && isGiftKind(e)),
        redeemable: sumWhere((e) => e.memberId === member),
      };
    },
    async allowanceUsed(giver, day) {
      await yieldNow();
      return allowanceUsed(s.entries, giver, day);
    },
    async netPerReceiver(gift) {
      await yieldNow();
      return netPerReceiver(s.entries, gift);
    },
    async gift(id) {
      await yieldNow();
      return s.gifts.get(id) ?? null;
    },
    async giftByMessage(messageRef) {
      await yieldNow();
      return [...s.gifts.values()].find((g) => g.source === "message" && g.messageRef === messageRef) ?? null;
    },
    async activeReactionGift(giver, messageRef, emoji) {
      await yieldNow();
      const held = reactionGifts(giver, messageRef, emoji).filter((g) => [...netPerReceiver(s.entries, g.id).values()].some((n) => n > 0));
      return held.at(-1) ?? null;
    },
    async reactionClosedByAdmin(giver, messageRef, emoji) {
      await yieldNow();
      return reactionGifts(giver, messageRef, emoji).some((g) => g.closedBy === "admin");
    },
    async reactionReversals(giver, messageRef, emoji, day) {
      await yieldNow();
      const ids = new Set(reactionGifts(giver, messageRef, emoji).map((g) => g.id));
      const reversed = new Set<GiftId>();
      for (const e of s.entries) {
        if (e.kind === "gift_reversal" && e.cause.type === "gift" && ids.has(e.cause.giftId) && e.allowanceDay === day && e.reason === "reaction_removed") reversed.add(e.cause.giftId);
      }
      return reversed.size;
    },
    async redeemableByMember() {
      await yieldNow();
      const out = new Map<MemberId, number>();
      for (const e of s.entries) out.set(e.memberId, (out.get(e.memberId) ?? 0) + signedAmount(e));
      return out;
    },
    async entries() {
      await yieldNow();
      return [...s.entries];
    },
    async commandLog() {
      await yieldNow();
      return [...s.log.values()].flatMap((r) => (r.status === "done" ? [r.record] : []));
    },
  };
  return reader;
}

export function createMemoryPorts(opts: MemoryOptions = {}) {
  const workspaces = new Map<WorkspaceId, WorkspaceState>();
  const mutex = new KeyedMutex();
  const locking = opts.locking ?? true;
  let now = (opts.now ?? 0) as Instant;
  let issued = 0;
  let entrySeq = 0;
  let eventSeq = 0;
  /** Lock lists in acquisition order, one per unit of work (for assertions). */
  const lockLog: LockKey[][] = [];

  const ws = (id: WorkspaceId): WorkspaceState => {
    const s = workspaces.get(id);
    if (!s) throw new Error(`unknown workspace ${id}`);
    return s;
  };

  function makeTx(s: WorkspaceState, wsId: WorkspaceId) {
    let claimed: CommandKey | null = null;
    let committed = false;
    const tx: Tx = {
      ...readerFor(s),
      async claim(key, requestHash): Promise<Claim> {
        for (;;) {
          await yieldNow();
          const row = s.log.get(key);
          if (row === undefined) {
            let settle!: () => void;
            const settled = new Promise<void>((r) => (settle = r));
            s.log.set(key, { status: "running", requestHash, settled, settle });
            claimed = key;
            return { status: "claimed" };
          }
          if (row.status === "done") return { status: "done", requestHash: row.record.requestHash, result: row.record.result };
          await row.settled; // G2: wait on the first transaction, then read its stored result
        }
      },
      async commit<T>(c: Commit<T>) {
        await yieldNow();
        if (claimed !== c.key) throw new Error(`commit for ${c.key} without a claim`);
        const { decision } = c;
        // Prepare everything first so a failure leaves no trace (atomicity).
        const apply = decision.writes.map((w) => (WRITE_APPLIERS[w.t] as (s: WorkspaceState, w: StateWrite) => () => void)(s, w));
        for (const e of decision.entries) {
          if (!Number.isSafeInteger(e.amount) || e.amount < 1) throw new Error(`entry amount must be a positive integer, got ${e.amount}`);
        }
        const entries = decision.entries.map((e, ordinal) => Object.freeze({ ...e, seq: ++entrySeq, workspaceId: wsId, commandKey: c.key, ordinal, at: c.at }));
        const events = decision.events.map((event, ordinal) => Object.freeze({ seq: ++eventSeq, workspaceId: wsId, commandKey: c.key, ordinal, at: c.at, event }));
        const record: CommandLogRecord = { workspaceId: wsId, key: c.key, requestHash: c.requestHash, commandType: c.commandType, actor: c.actor, at: c.at, command: c.command, result: decision.outcome };
        for (const f of apply) f();
        s.entries.push(...entries);
        s.events.push(...events);
        const row = s.log.get(c.key);
        s.log.set(c.key, { status: "done", record });
        if (row?.status === "running") row.settle();
        committed = true;
      },
    };
    const rollback = () => {
      if (claimed === null || committed) return;
      const row = s.log.get(claimed);
      if (row?.status === "running") {
        s.log.delete(claimed);
        row.settle();
      }
    };
    return { tx, rollback };
  }

  const base: Ports = {
    uow: {
      async run(wsId, locks, fn) {
        const s = ws(wsId);
        const ordered = orderLocks(locks);
        if (ordered.length !== locks.length || ordered.some((k, i) => k !== locks[i])) throw new Error(`locks must be declared in order: ${locks.join(", ")}`);
        lockLog.push([...locks]);
        const releases: (() => void)[] = [];
        if (locking) for (const k of locks) releases.push(await mutex.acquire(`${wsId}|${k}`));
        const { tx, rollback } = makeTx(s, wsId);
        try {
          const out = await fn(tx);
          rollback(); // no-op when committed; frees a claim the handler never committed
          return out;
        } catch (err) {
          rollback();
          throw err;
        } finally {
          for (const r of releases.reverse()) r();
        }
      },
    },
    reader: { workspace: (wsId) => readerFor(ws(wsId)) },
    directory: {
      settings: async (wsId) => ws(wsId).settings,
      member: async (wsId, id) => ws(wsId).members.get(id) ?? null,
      members: async (wsId) => [...ws(wsId).members.values()],
      values: async (wsId) => ws(wsId).values,
    },
    clock: { now: () => now },
    ids: {
      next: (kind) => `${kind}-${++issued}`,
    },
  };

  const entriesOf = (id: WorkspaceId): readonly LedgerEntry[] => [...ws(id).entries];
  // The shop store (S44-S59, S104) is part of the memory ports: shop writes commit atomically with the ledger.
  const shop = withShopStore({ ports: base, entries: entriesOf }, { giftCards: opts.giftCards ?? null });

  return {
    ports: shop.ports,
    /** The shop records (rewards, redemptions, collabs) for assertions. */
    shop,
    lockLog,
    clock: {
      set: (instant: number) => void (now = instant as Instant),
      advance: (ms: number) => void (now = (now + ms) as Instant),
    },
    idsIssued: () => issued,
    addWorkspace(id: WorkspaceId, settings: WorkspaceSettings) {
      workspaces.set(id, { settings, members: new Map(), values: [], entries: [], gifts: new Map(), log: new Map(), events: [] });
    },
    updateSettings(id: WorkspaceId, f: (s: WorkspaceSettings) => WorkspaceSettings) {
      const s = ws(id);
      s.settings = f(s.settings);
    },
    /** Adds or replaces a member record. */
    addMember(id: WorkspaceId, record: MemberRecord) {
      ws(id).members.set(record.id, record);
    },
    setValues(id: WorkspaceId, values: readonly Value[]) {
      ws(id).values = values;
    },
    entries: entriesOf,
    events: (id: WorkspaceId): readonly EventRecord[] => [...ws(id).events],
    gifts: (id: WorkspaceId): readonly Gift[] => [...ws(id).gifts.values()],
    commandLog: (id: WorkspaceId): readonly CommandLogRecord[] =>
      [...ws(id).log.values()].flatMap((r) => (r.status === "done" ? [r.record] : [])),
  };
}

export type MemoryPorts = ReturnType<typeof createMemoryPorts>;
export type { LedgerReader };
