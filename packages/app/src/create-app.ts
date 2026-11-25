// createApp(ports): the single write entrypoint `execute` plus read-only queries (G2, G3).
import {
  auditRecord,
  capEntries,
  dailyLimit,
  localDate,
  orderLocks,
  remainingAllowance,
  replay,
  type AuditRecord,
  type Balances,
  type BillingStore,
  type CommandBase,
  type LocalDate,
  type MemberId,
  type Ports,
  type Result,
  type WorkspaceId,
} from "@propi/core";
import type { LoadContext, RegisteredHandler } from "./handler.ts";
import { requestHash } from "./hash.ts";
import { workspacePlan } from "./billing/index.ts";
import { HANDLERS, type AppCommand, type AppResults } from "./registry.ts";

export interface AllowanceView {
  readonly day: LocalDate;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
}

export interface LedgerCheck {
  readonly ok: boolean;
  readonly members: number;
  readonly mismatches: readonly { readonly memberId: MemberId; readonly stored: Balances; readonly replayed: Balances }[];
}

export interface CreateAppOptions {
  /** Extra handlers (e.g. from a plugin module); they may not reuse a registered command type. */
  readonly handlers?: readonly RegisteredHandler[];
  /** S7: when set, the plan limit applies (Free over its member limit takes no new redemptions). */
  readonly billing?: BillingStore;
}

export type ResultOf<C extends { readonly type: string }> = Result<C["type"] extends keyof AppResults ? AppResults[C["type"]] : unknown>;

export interface App {
  /** The only write entrypoint: locks -> claim -> load -> decide -> commit. */
  execute<C extends AppCommand>(cmd: C): Promise<ResultOf<C>>;
  /** For commands registered through `options.handlers`. */
  executeAny(cmd: CommandBase & { readonly type: string }): Promise<Result<unknown>>;
  balances(ws: WorkspaceId, member: MemberId): Promise<Balances>;
  /** S28: remaining allowance at any time. */
  allowance(ws: WorkspaceId, member: MemberId): Promise<AllowanceView>;
  /** S40: every admin adjustment with actor, time and reason. */
  auditLog(ws: WorkspaceId): Promise<readonly AuditRecord[]>;
  /** S34: stored-query balances must equal a full replay of the ledger. */
  ledgerCheck(ws: WorkspaceId): Promise<LedgerCheck>;
}

export function createApp(ports: Ports, options: CreateAppOptions = {}): App {
  const registry = new Map<string, RegisteredHandler>();
  for (const h of [...HANDLERS, ...(options.handlers ?? [])]) {
    if (registry.has(h.type)) throw new Error(`duplicate handler for command type ${h.type}`);
    registry.set(h.type, h);
  }
  const billing = options.billing;
  const plan = billing === undefined ? undefined : (ws: WorkspaceId) => workspacePlan({ billing, directory: ports.directory, clock: ports.clock }, ws);

  async function run(cmd: CommandBase & { readonly type: string }): Promise<Result<unknown>> {
    const handler = registry.get(cmd.type);
    if (handler === undefined) throw new Error(`no handler for command type ${cmd.type}`);
    const ws = cmd.workspaceId;
    const settings = await ports.directory.settings(ws);
    const hash = requestHash(cmd);
    const c = cmd as never;

    // 1. Declare lock keys up front, in the global order (G4).
    const locks = orderLocks(await handler.locks(c, { directory: ports.directory, reader: ports.reader.workspace(ws), settings }));

    return ports.uow.run(ws, locks, async (tx) => {
      // Live commands run at the server clock; history imports keep the source timestamp (HandlerClock).
      const now = handler.clock === "command" ? cmd.at : ports.clock.now();
      const ctx: LoadContext = { directory: ports.directory, ids: ports.ids, settings, now, ...(plan === undefined ? {} : { plan }) };
      const key = handler.resolveKey ? await handler.resolveKey(c, tx, ctx) : cmd.key;

      // 2. Claim the command key first (G2): a stored result is replayed, never recomputed.
      const claim = await tx.claim(key, hash);
      if (claim.status === "done") {
        if (claim.requestHash !== hash) return { ok: false, replayed: true, error: { code: "idempotency_key_reused", originalRequestHash: claim.requestHash } };
        return { ...claim.result, replayed: true };
      }

      // 3. Load the snapshot, 4. decide (pure), 5. commit everything atomically.
      const snapshot = await handler.load(c, tx, ctx);
      const decision = capEntries(handler.decide(snapshot as never, c, now));
      await tx.commit({ key, requestHash: hash, commandType: cmd.type, actor: cmd.actor, at: now, command: cmd, decision });
      return { ...decision.outcome, replayed: false };
    });
  }

  return {
    execute: (cmd) => run(cmd) as never,
    executeAny: (cmd) => run(cmd),

    balances: (ws, member) => ports.reader.workspace(ws).balances(member),

    async allowance(ws, member) {
      const settings = await ports.directory.settings(ws);
      const record = await ports.directory.member(ws, member);
      const day = localDate(ports.clock.now(), settings.timezone);
      const used = await ports.reader.workspace(ws).allowanceUsed(member, day);
      const limit = dailyLimit(record ?? { role: "member", dailyLimitOverride: null }, settings);
      return { day, limit, used, remaining: remainingAllowance(limit, used) };
    },

    async auditLog(ws) {
      const out: AuditRecord[] = [];
      for (const row of await ports.reader.workspace(ws).commandLog()) {
        const rec = auditRecord(row);
        if (rec !== null) out.push(rec);
      }
      return out;
    },

    async ledgerCheck(ws) {
      const reader = ports.reader.workspace(ws);
      const replayed = replay(await reader.entries());
      const mismatches: { memberId: MemberId; stored: Balances; replayed: Balances }[] = [];
      for (const [memberId, fromReplay] of replayed) {
        const stored = await reader.balances(memberId);
        if (stored.received !== fromReplay.received || stored.given !== fromReplay.given || stored.redeemable !== fromReplay.redeemable) {
          mismatches.push({ memberId, stored, replayed: fromReplay });
        }
      }
      return { ok: mismatches.length === 0, members: replayed.size, mismatches };
    },
  };
}
