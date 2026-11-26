// The Postgres implementation of the app ports (architecture §1.6, §1.7, G2, G4).
//
// - UnitOfWork.run = one Prisma interactive transaction at READ COMMITTED that first takes
//   pg_advisory_xact_lock on every declared key, in the given (globally sorted) order.
// - Tx.claim inserts the command_log row as 'running' (ON CONFLICT DO NOTHING); a concurrent
//   duplicate blocks on that uncommitted row and then reads the stored result (G2).
// - Tx.commit completes the claim and writes entries, state and events in the same transaction.
// - Every balance is a SQL sum over ledger_entry; the kind lists come from core EFFECTS (G1).
// - Shop reads ride on the Tx and the lock-time reader; module writes (shop CAS, engagement)
//   apply in the same transaction through MODULE_APPLIERS (modules.ts).
import {
  orderLocks,
  signedAmount,
  type Balances,
  type Cause,
  type Claim,
  type Clock,
  type CommandKey,
  type CommandLogRecord,
  type Commit,
  type Directory,
  type DomainEvent,
  type Gift,
  type GiftCardProvider,
  type GiftClosure,
  type GiftId,
  type GiftSource,
  type Ids,
  type Instant,
  type LedgerEntry,
  type LocalDate,
  type LockKey,
  type MemberId,
  type MemberProfile,
  type LanguageChoice,
  isLocale,
  type MemberRecord,
  type Outcome,
  type PosInt,
  type Ports,
  type Role,
  type StateWrite,
  type Tx,
  type Value,
  type ValueId,
  type WorkspaceId,
  type WorkspaceReader,
  type WorkspaceSettings,
} from "@propi/core";
import { Prisma, type PrismaClient } from "./client.ts";
import { SQL_LISTS } from "./effects-sql.ts";
import { MODULE_APPLIERS, activeUnit, shopReader } from "./modules.ts";
import { safeNumber } from "./numbers.ts";
import { systemClock, uuidv7, uuidv7Ids } from "./runtime.ts";
import { settingsFromJson, settingsToJson, toJson } from "./settings-json.ts";

/** What both a transaction and the plain client can run. */
type Sql = Prisma.TransactionClient;

const GIFT_KINDS = Prisma.raw(SQL_LISTS.received);
const GIVEN_KINDS = Prisma.raw(SQL_LISTS.given);
const REDEEMABLE_KINDS = Prisma.raw(SQL_LISTS.redeemable);

export interface DbPortsOptions {
  readonly clock?: Clock;
  readonly ids?: Ids;
  /** Max time to wait for a pool connection (ms). */
  readonly maxWaitMs?: number;
  /** Max time one unit of work may run, lock waits included (ms). */
  readonly timeoutMs?: number;
  /** Testing only: false skips the advisory locks, to show the race they prevent is real. */
  readonly advisoryLocks?: boolean;
  /** S108: the gift-card provider behind ShopReader.prepaidAvailable; null/absent = no provider. */
  readonly giftCards?: GiftCardProvider | null;
}

/** Thrown inside the transaction to roll back a claim the handler never committed. */
class RollbackUncommittedClaim extends Error {}

// ───────────── Row mapping ─────────────

interface EntryRow {
  seq: bigint;
  workspace_id: string;
  command_key: string;
  ordinal: number;
  kind: LedgerEntry["kind"];
  amount: number;
  member_id: string;
  counterpart_id: string | null;
  cause: Cause;
  source: GiftSource | null;
  allowance_day: string | null;
  at: Date;
  reason: string | null;
}

const toEntry = (r: EntryRow): LedgerEntry =>
  Object.freeze({
    kind: r.kind,
    amount: Math.abs(r.amount) as PosInt,
    memberId: r.member_id as MemberId,
    counterpartId: r.counterpart_id as MemberId | null,
    cause: r.cause,
    source: r.source,
    allowanceDay: r.allowance_day as LocalDate | null,
    reason: r.reason,
    seq: Number(r.seq),
    workspaceId: r.workspace_id as WorkspaceId,
    commandKey: r.command_key as CommandKey,
    ordinal: r.ordinal,
    at: r.at.getTime() as Instant,
  });

interface GiftRow {
  id: string;
  giver_id: string;
  message_ref: string | null;
  source: GiftSource;
  emoji: string | null;
  channel_id: string;
  is_private: boolean;
  text: string | null;
  value_ids: string[];
  allowance_day: string | null;
  created_at: Date;
  closed_by: GiftClosure | null;
}

const toGift = (r: GiftRow): Gift => ({
  id: r.id as GiftId,
  giver: r.giver_id as MemberId,
  messageRef: r.message_ref,
  source: r.source,
  emoji: r.emoji,
  channelId: r.channel_id,
  isPrivate: r.is_private,
  text: r.text,
  valueIds: r.value_ids as ValueId[],
  allowanceDay: r.allowance_day as LocalDate | null,
  createdAt: r.created_at.getTime() as Instant,
  closedBy: r.closed_by,
});

const GIFT_SELECT = Prisma.sql`
  SELECT g.id, g.giver_id, g.message_ref, g.source, g.emoji, g.channel_id, g.is_private, g.text,
         g.allowance_day::text AS allowance_day, g.created_at, g.closed_by,
         COALESCE((SELECT array_agg(v.value_id ORDER BY v.ordinal) FROM gift_value v
                   WHERE v.workspace_id = g.workspace_id AND v.gift_id = g.id), '{}') AS value_ids
  FROM gift g`;

interface LogRow {
  workspace_id: string;
  key: string;
  request_hash: string;
  command_type: string;
  actor: CommandLogRecord["actor"];
  command: unknown;
  result: Outcome<unknown>;
  at: Date;
}

const toLogRecord = (r: LogRow): CommandLogRecord => ({
  workspaceId: r.workspace_id as WorkspaceId,
  key: r.key as CommandKey,
  requestHash: r.request_hash,
  commandType: r.command_type,
  actor: r.actor,
  at: r.at.getTime() as Instant,
  command: r.command,
  result: r.result,
});

/** The main id of a cause, for the (cause_type, cause_id) index. */
function causeId(c: Cause): string | null {
  switch (c.type) {
    case "gift":
      return c.giftId;
    case "redemption":
      return c.redemptionId;
    case "contribution":
      return c.collabId;
    case "rule":
      return `${c.ruleId}:${c.period}`;
    case "quest":
      return c.submissionId;
    case "milestone":
      return `${c.milestone}:${c.year}`;
    case "admin":
    case "import":
      return null;
  }
}

// ───────────── Readers ─────────────

/** Every gift header of a workspace, in creation order. */
export async function readGifts(db: Sql, ws: WorkspaceId): Promise<Gift[]> {
  const rows = await db.$queryRaw<GiftRow[]>`${GIFT_SELECT} WHERE g.workspace_id = ${ws} ORDER BY g.seq`;
  return rows.map(toGift);
}

function ledgerReader(db: Sql, ws: WorkspaceId): WorkspaceReader {
  const int = async (q: Prisma.Sql): Promise<number> => {
    const [row] = await db.$queryRaw<{ n: bigint | number }[]>(q);
    return safeNumber(row?.n);
  };
  const reactionGiftIds = (giver: MemberId, messageRef: string, emoji: string) => Prisma.sql`
    SELECT id FROM gift WHERE workspace_id = ${ws} AND source = 'reaction'
      AND giver_id = ${giver} AND message_ref = ${messageRef} AND emoji = ${emoji}`;

  return {
    async balances(member): Promise<Balances> {
      const [row] = await db.$queryRaw<{ received: bigint; given: bigint; redeemable: bigint }[]>`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE member_id = ${member} AND kind IN (${GIFT_KINDS})), 0)::bigint AS received,
          COALESCE(SUM(amount) FILTER (WHERE counterpart_id = ${member} AND kind IN (${GIVEN_KINDS})), 0)::bigint AS given,
          COALESCE(SUM(amount) FILTER (WHERE member_id = ${member} AND kind IN (${REDEEMABLE_KINDS})), 0)::bigint AS redeemable
        FROM ledger_entry
        WHERE workspace_id = ${ws} AND (member_id = ${member} OR counterpart_id = ${member})`;
      return { received: safeNumber(row?.received), given: safeNumber(row?.given), redeemable: safeNumber(row?.redeemable) };
    },

    allowanceUsed: (giver, day) =>
      int(Prisma.sql`
        SELECT COALESCE(SUM(amount), 0)::bigint AS n FROM ledger_entry
        WHERE workspace_id = ${ws} AND counterpart_id = ${giver} AND allowance_day = ${day}::date AND kind IN (${GIVEN_KINDS})`),

    async netPerReceiver(gift) {
      const rows = await db.$queryRaw<{ member_id: string; net: bigint }[]>`
        SELECT member_id, SUM(amount)::bigint AS net FROM ledger_entry
        WHERE workspace_id = ${ws} AND cause_type = 'gift' AND cause_id = ${gift} AND kind IN (${GIFT_KINDS})
        GROUP BY member_id ORDER BY MIN(seq)`;
      return new Map(rows.map((r) => [r.member_id as MemberId, safeNumber(r.net)]));
    },

    async gift(id) {
      const [row] = await db.$queryRaw<GiftRow[]>`${GIFT_SELECT} WHERE g.workspace_id = ${ws} AND g.id = ${id}`;
      return row ? toGift(row) : null;
    },

    async giftByMessage(messageRef) {
      const [row] = await db.$queryRaw<GiftRow[]>`
        ${GIFT_SELECT} WHERE g.workspace_id = ${ws} AND g.source = 'message' AND g.message_ref = ${messageRef}
        ORDER BY g.seq LIMIT 1`;
      return row ? toGift(row) : null;
    },

    async activeReactionGift(giver, messageRef, emoji) {
      const [row] = await db.$queryRaw<GiftRow[]>`
        ${GIFT_SELECT} WHERE g.workspace_id = ${ws} AND g.id IN (${reactionGiftIds(giver, messageRef, emoji)})
          AND EXISTS (
            SELECT 1 FROM ledger_entry e
            WHERE e.workspace_id = ${ws} AND e.cause_type = 'gift' AND e.cause_id = g.id AND e.kind IN (${GIFT_KINDS})
            GROUP BY e.member_id HAVING SUM(e.amount) > 0)
        ORDER BY g.seq DESC LIMIT 1`;
      return row ? toGift(row) : null;
    },

    async reactionClosedByAdmin(giver, messageRef, emoji) {
      const [row] = await db.$queryRaw<{ closed: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM gift WHERE workspace_id = ${ws} AND closed_by = 'admin' AND id IN (${reactionGiftIds(giver, messageRef, emoji)})
        ) AS closed`;
      return row?.closed ?? false;
    },

    reactionReversals: (giver, messageRef, emoji, day) =>
      int(Prisma.sql`
        SELECT COUNT(DISTINCT cause_id)::int AS n FROM ledger_entry
        WHERE workspace_id = ${ws} AND kind = 'gift_reversal' AND cause_type = 'gift'
          AND cause_id IN (${reactionGiftIds(giver, messageRef, emoji)})
          AND allowance_day = ${day}::date AND reason = 'reaction_removed'`),

    async redeemableByMember() {
      const rows = await db.$queryRaw<{ member_id: string; n: bigint }[]>`
        SELECT member_id, SUM(amount)::bigint AS n FROM ledger_entry
        WHERE workspace_id = ${ws} AND kind IN (${REDEEMABLE_KINDS})
        GROUP BY member_id ORDER BY member_id`;
      return new Map(rows.map((r) => [r.member_id as MemberId, safeNumber(r.n)]));
    },

    async entries() {
      const rows = await db.$queryRaw<EntryRow[]>`
        SELECT seq, workspace_id, command_key, ordinal, kind, amount, member_id, counterpart_id, cause, source,
               allowance_day::text AS allowance_day, at, reason
        FROM ledger_entry WHERE workspace_id = ${ws} ORDER BY seq`;
      return rows.map(toEntry);
    },

    async commandLog() {
      const rows = await db.$queryRaw<LogRow[]>`
        SELECT workspace_id, key, request_hash, command_type, actor, command, result, at
        FROM command_log WHERE workspace_id = ${ws} AND status = 'done' ORDER BY seq`;
      return rows.map(toLogRecord);
    },
  };
}

// ───────────── Writes ─────────────

/** One applier per StateWrite kind (exhaustive: a new write kind fails to compile here). */
const WRITE_APPLIERS: { readonly [K in StateWrite["t"]]: (db: Sql, ws: WorkspaceId, w: Extract<StateWrite, { t: K }>) => Promise<void> } = {
  async "gift.upsert"(db, ws, { gift: g }) {
    await db.$executeRaw`
      INSERT INTO gift (workspace_id, id, giver_id, message_ref, source, emoji, channel_id, is_private, text, allowance_day, created_at, closed_by)
      VALUES (${ws}, ${g.id}, ${g.giver}, ${g.messageRef}, ${g.source}, ${g.emoji}, ${g.channelId}, ${g.isPrivate}, ${g.text},
              ${g.allowanceDay}::date, ${new Date(g.createdAt)}, ${g.closedBy})
      ON CONFLICT (workspace_id, id) DO UPDATE SET
        giver_id = EXCLUDED.giver_id, message_ref = EXCLUDED.message_ref, source = EXCLUDED.source, emoji = EXCLUDED.emoji,
        channel_id = EXCLUDED.channel_id, is_private = EXCLUDED.is_private, text = EXCLUDED.text,
        allowance_day = EXCLUDED.allowance_day, created_at = EXCLUDED.created_at,
        -- A closure is final (S23, S38): an upsert never reopens a closed gift.
        closed_by = COALESCE(gift.closed_by, EXCLUDED.closed_by)`;
    // The gift's value tags are whatever the decider last computed (an edit re-quotes them).
    await db.$executeRaw`DELETE FROM gift_value WHERE workspace_id = ${ws} AND gift_id = ${g.id}`;
    if (g.valueIds.length > 0) {
      const rows = g.valueIds.map((valueId, ordinal) => Prisma.sql`(${ws}, ${g.id}, ${valueId}, ${ordinal})`);
      await db.$executeRaw`INSERT INTO gift_value (workspace_id, gift_id, value_id, ordinal) VALUES ${Prisma.join(rows)}`;
    }
  },
};

type Applier = (db: Sql, ws: WorkspaceId, w: StateWrite) => Promise<void>;

async function commitDecision<T>(db: Sql, ws: WorkspaceId, c: Commit<T>): Promise<void> {
  const { decision } = c;
  for (const e of decision.entries) {
    if (!Number.isSafeInteger(e.amount) || e.amount < 1) throw new Error(`entry amount must be a positive integer, got ${e.amount}`);
  }
  const at = new Date(c.at);
  const done = await db.$executeRaw`
    UPDATE command_log SET status = 'done', command_type = ${c.commandType}, actor = ${toJson(c.actor)}::jsonb,
      command = ${toJson(c.command)}::jsonb, result = ${toJson(decision.outcome)}::jsonb, at = ${at}
    WHERE workspace_id = ${ws} AND key = ${c.key} AND status = 'running' AND request_hash = ${c.requestHash}`;
  if (done !== 1) throw new Error(`commit for ${c.key} without a matching claim`);

  for (const w of decision.writes) {
    // Decisions carry core StateWrites plus module writes (ShopWrite, engagement writes).
    const apply = (WRITE_APPLIERS as Partial<Record<string, Applier>>)[w.t] ?? (MODULE_APPLIERS as unknown as Partial<Record<string, Applier>>)[w.t];
    if (apply === undefined) throw new Error(`no Postgres applier for state write ${w.t}`);
    await apply(db, ws, w);
  }

  if (decision.entries.length > 0) {
    const rows = decision.entries.map(
      (e, ordinal) => Prisma.sql`(${ws}, ${c.key}, ${ordinal}, ${e.kind}, ${signedAmount(e)}, ${e.memberId}, ${e.counterpartId},
        ${e.cause.type}, ${causeId(e.cause)}, ${toJson(e.cause)}::jsonb, ${e.source}, ${e.allowanceDay}::date, ${at}, ${e.reason})`,
    );
    await db.$executeRaw`
      INSERT INTO ledger_entry (workspace_id, command_key, ordinal, kind, amount, member_id, counterpart_id,
        cause_type, cause_id, cause, source, allowance_day, at, reason)
      VALUES ${Prisma.join(rows)}`;
  }

  if (decision.events.length > 0) {
    const rows = decision.events.map(
      (ev: DomainEvent, ordinal) => Prisma.sql`(${uuidv7(c.at)}, ${ws}, ${c.key}, ${ordinal}, ${ev.type}, ${toJson(ev)}::jsonb, ${at})`,
    );
    await db.$executeRaw`
      INSERT INTO domain_event (id, workspace_id, command_key, ordinal, type, payload, at) VALUES ${Prisma.join(rows)}`;
  }
}

// ───────────── Ports ─────────────

export function createDbPorts(prisma: PrismaClient, opts: DbPortsOptions = {}): Ports {
  const clock = opts.clock ?? systemClock;
  const ids = opts.ids ?? uuidv7Ids;
  const giftCards = opts.giftCards ?? null;

  const uow: Ports["uow"] = {
    async run(ws, locks, fn) {
      const ordered = orderLocks(locks);
      if (ordered.length !== locks.length || ordered.some((k, i) => k !== locks[i])) {
        throw new Error(`locks must be declared in order: ${locks.join(", ")}`);
      }
      let out!: Awaited<ReturnType<typeof fn>>;
      try {
        await prisma.$transaction(
          async (db) => {
            // G4: one global order, so lock waits can never form a cycle. Keys are scoped by workspace.
            if (opts.advisoryLocks !== false) for (const k of locks) await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockName(ws, k)}, 0))`;
            let claimed: CommandKey | null = null;
            let committed = false;
            const tx: Tx = {
              ...ledgerReader(db, ws),
              ...shopReader(db, ws, giftCards),
              async claim(key, requestHash): Promise<Claim> {
                const inserted = await db.$queryRaw<{ key: string }[]>`
                  INSERT INTO command_log (workspace_id, key, request_hash, status) VALUES (${ws}, ${key}, ${requestHash}, 'running')
                  ON CONFLICT (workspace_id, key) DO NOTHING RETURNING key`;
                if (inserted.length === 1) {
                  claimed = key;
                  return { status: "claimed" };
                }
                // The conflicting insert waited for the first transaction; this new statement sees its commit.
                const [row] = await db.$queryRaw<{ status: string; request_hash: string; result: Outcome<unknown> }[]>`
                  SELECT status, request_hash, result FROM command_log WHERE workspace_id = ${ws} AND key = ${key}`;
                if (row === undefined || row.status !== "done") throw new Error(`command ${key} is claimed but not done`);
                return { status: "done", requestHash: row.request_hash, result: row.result };
              },
              async commit(c) {
                if (claimed !== c.key) throw new Error(`commit for ${c.key} without a claim`);
                await commitDecision(db, ws, c);
                committed = true;
              },
            };
            // Module stores read through this transaction while the unit runs (modules.ts).
            out = await activeUnit.run({ ws, db }, () => fn(tx));
            if (claimed !== null && !committed) throw new RollbackUncommittedClaim();
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: opts.maxWaitMs ?? 10_000,
            timeout: opts.timeoutMs ?? 30_000,
          },
        );
      } catch (err) {
        if (!(err instanceof RollbackUncommittedClaim)) throw err;
      }
      return out;
    },
  };

  const directory: Directory = {
    async settings(ws) {
      const [row] = await prisma.$queryRaw<{ settings: unknown }[]>`SELECT settings FROM workspace WHERE id = ${ws}`;
      if (row === undefined) throw new Error(`unknown workspace ${ws}`);
      return settingsFromJson(row.settings);
    },
    async member(ws, id) {
      const [row] = await prisma.$queryRaw<MemberRow[]>`
        SELECT id, role, active, daily_limit_override, display_name, avatar_url, language, slack_locale FROM member WHERE workspace_id = ${ws} AND id = ${id}`;
      return row ? toMember(row) : null;
    },
    async members(ws) {
      const rows = await prisma.$queryRaw<MemberRow[]>`
        SELECT id, role, active, daily_limit_override, display_name, avatar_url, language, slack_locale FROM member WHERE workspace_id = ${ws} ORDER BY id`;
      return rows.map(toMember);
    },
    async values(ws) {
      const rows = await prisma.$queryRaw<{ id: string; name: string; hashtag: string | null; emoji: string | null }[]>`
        SELECT id, name, hashtag, emoji FROM value WHERE workspace_id = ${ws} ORDER BY position`;
      return rows.map((r) => ({ id: r.id as ValueId, name: r.name, hashtag: r.hashtag, emoji: r.emoji }));
    },
  };

  return {
    uow,
    reader: { workspace: (ws) => ({ ...ledgerReader(prisma, ws), ...shopReader(prisma, ws, giftCards) }) },
    directory,
    clock,
    ids,
  };
}

/** The advisory lock name: lock keys are per workspace. */
export const lockName = (ws: WorkspaceId, k: LockKey): string => `${ws}|${k}`;

interface MemberRow {
  id: string;
  role: Role;
  active: boolean;
  daily_limit_override: number | null;
  display_name: string | null;
  avatar_url: string | null;
  language: string | null;
  slack_locale: string | null;
}

const toMember = (r: MemberRow): MemberRecord => ({
  id: r.id as MemberId,
  role: r.role,
  active: r.active,
  dailyLimitOverride: r.daily_limit_override as PosInt | null,
  // S6: present only when known, so records without a profile keep their previous shape.
  ...(r.display_name === null ? {} : { displayName: r.display_name }),
  ...(r.avatar_url === null ? {} : { avatarUrl: r.avatar_url }),
  // i18n S3, S4c: likewise present only when set; no language means "auto".
  ...(isLocale(r.language) ? { language: r.language } : {}),
  ...(r.slack_locale === null ? {} : { slackLocale: r.slack_locale }),
});

// ───────────── Administration (setup, seeding, tests) ─────────────

/** Configuration writes that are not ledger commands yet (workspace and member setup). */
export function createDbAdmin(prisma: PrismaClient) {
  return {
    async addWorkspace(id: WorkspaceId, settings: WorkspaceSettings): Promise<void> {
      await prisma.$executeRaw`
        INSERT INTO workspace (id, settings) VALUES (${id}, ${toJson(settingsToJson(settings))}::jsonb)
        ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings`;
    },
    async updateSettings(id: WorkspaceId, f: (s: WorkspaceSettings) => WorkspaceSettings): Promise<void> {
      await prisma.$transaction(async (db) => {
        const [row] = await db.$queryRaw<{ settings: unknown }[]>`SELECT settings FROM workspace WHERE id = ${id} FOR UPDATE`;
        if (row === undefined) throw new Error(`unknown workspace ${id}`);
        const next = f(settingsFromJson(row.settings));
        await db.$executeRaw`UPDATE workspace SET settings = ${toJson(settingsToJson(next))}::jsonb WHERE id = ${id}`;
      });
    },
    /**
     * Adds or replaces a member record. A profile, Slack locale or language left out keeps the stored
     * one (S6, i18n S3-S4); setMemberLanguage is the only way back to "auto".
     */
    async addMember(ws: WorkspaceId, r: MemberRecord): Promise<void> {
      await prisma.$executeRaw`
        INSERT INTO member (workspace_id, id, role, active, daily_limit_override, display_name, avatar_url, language, slack_locale)
        VALUES (${ws}, ${r.id}, ${r.role}, ${r.active}, ${r.dailyLimitOverride}, ${r.displayName ?? null}, ${r.avatarUrl ?? null}, ${r.language ?? null}, ${r.slackLocale ?? null})
        ON CONFLICT (workspace_id, id) DO UPDATE SET
          role = EXCLUDED.role, active = EXCLUDED.active, daily_limit_override = EXCLUDED.daily_limit_override,
          display_name = COALESCE(EXCLUDED.display_name, member.display_name),
          avatar_url = COALESCE(EXCLUDED.avatar_url, member.avatar_url),
          language = COALESCE(EXCLUDED.language, member.language),
          slack_locale = COALESCE(EXCLUDED.slack_locale, member.slack_locale)`;
    },
    /**
     * S6: stores the member's chat display name and avatar, and (i18n S3) their Slack locale when the
     * profile carries one; a profile without `slackLocale` keeps the stored locale. Unknown members are left alone.
     */
    async setMemberProfile(ws: WorkspaceId, id: MemberId, p: MemberProfile): Promise<void> {
      const keepLocale = p.slackLocale === undefined;
      await prisma.$executeRaw`
        UPDATE member SET display_name = ${p.displayName}, avatar_url = ${p.avatarUrl},
          slack_locale = CASE WHEN ${keepLocale} THEN slack_locale ELSE ${p.slackLocale ?? null} END
        WHERE workspace_id = ${ws} AND id = ${id}`;
    },
    /** i18n S4c: the member's own language; "auto" clears it (Slack locale, then workspace default). */
    async setMemberLanguage(ws: WorkspaceId, id: MemberId, choice: LanguageChoice): Promise<void> {
      await prisma.$executeRaw`
        UPDATE member SET language = ${choice === "auto" ? null : choice} WHERE workspace_id = ${ws} AND id = ${id}`;
    },
    /** Replaces the workspace's values, keeping the given order. */
    async setValues(ws: WorkspaceId, values: readonly Value[]): Promise<void> {
      await prisma.$transaction(async (db) => {
        await db.$executeRaw`DELETE FROM value WHERE workspace_id = ${ws}`;
        for (const [position, v] of values.entries()) {
          await db.$executeRaw`
            INSERT INTO value (workspace_id, id, name, hashtag, emoji, position) VALUES (${ws}, ${v.id}, ${v.name}, ${v.hashtag}, ${v.emoji}, ${position})`;
        }
      });
    },
  };
}

export type DbAdmin = ReturnType<typeof createDbAdmin>;

// ───────────── Inspection (tests, CLI) ─────────────

export interface StoredEvent {
  readonly id: string;
  readonly seq: number;
  readonly workspaceId: WorkspaceId;
  readonly commandKey: CommandKey;
  readonly ordinal: number;
  readonly at: Instant;
  readonly event: DomainEvent;
}

/** Read-only views of raw state, for tests and operational tooling. */
export function createDbInspector(prisma: PrismaClient) {
  return {
    entries: (ws: WorkspaceId) => ledgerReader(prisma, ws).entries(),
    commandLog: (ws: WorkspaceId) => ledgerReader(prisma, ws).commandLog(),
    async events(ws: WorkspaceId): Promise<StoredEvent[]> {
      const rows = await prisma.$queryRaw<{ id: string; seq: bigint; command_key: string; ordinal: number; at: Date; payload: DomainEvent }[]>`
        SELECT id, seq, command_key, ordinal, at, payload FROM domain_event WHERE workspace_id = ${ws} ORDER BY seq`;
      return rows.map((r) => ({
        id: r.id,
        seq: Number(r.seq),
        workspaceId: ws,
        commandKey: r.command_key as CommandKey,
        ordinal: r.ordinal,
        at: r.at.getTime() as Instant,
        event: r.payload,
      }));
    },
    gifts: (ws: WorkspaceId): Promise<Gift[]> => readGifts(prisma, ws),
  };
}

export type DbInspector = ReturnType<typeof createDbInspector>;
