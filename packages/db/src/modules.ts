// Postgres state for the shop (S44-S59, S108) and the engagement modules (S60-S79, S92-S96),
// plus the S107 identity store. Migration 20261125020000_modules holds the tables.
//
// - Shop reads (ShopReader) ride on the Tx and on the lock-time reader, like the ledger reads.
// - Shop writes are compare-and-set: `UPDATE ... WHERE state = <from>` and a conditional stock
//   decrement `WHERE stock > 0`; when 0 rows change the write throws and the whole unit of work
//   (claim, entries, events) rolls back. Same semantics as the in-memory store (app/testing/shop.ts).
// - Engagement stores are read by ws outside the Tx interface; inside a unit of work they use that
//   unit's transaction (AsyncLocalStorage), so they never need a second pool connection.
import { AsyncLocalStorage } from "node:async_hooks";
import {
  DEFAULT_LEVEL_CONFIG,
  DEFAULT_MILESTONES,
  DEFAULT_PAIRING,
  DEFAULT_SHOP_SETTINGS,
  STICKERS_OFF,
  budgetSpent,
  prepaidReserved,
  type AwardRule,
  type Collab,
  type GiftCardProvider,
  type IdentityStore,
  type LevelConfig,
  type LevelStore,
  type LevelWrite,
  type MemberId,
  type MilestoneConfig,
  type MilestoneProfile,
  type MilestoneStore,
  type MilestoneWrite,
  type PairingConfig,
  type PairingRound,
  type PairingStore,
  type PairingWrite,
  type PlatformIdentity,
  type Quest,
  type QuestComment,
  type QuestStore,
  type QuestWrite,
  type Redemption,
  type Reward,
  type RewardVariant,
  type RuleStore,
  type RuleWrite,
  type ShopReader,
  type ShopSettings,
  type ShopWrite,
  type StickerConfig,
  type StickerDef,
  type StickerStore,
  type StickerWrite,
  type Submission,
  type WorkspaceId,
} from "@propi/core";
import { Prisma, type PrismaClient } from "./client.ts";
import { safeNumber } from "./numbers.ts";
import { toJson } from "./settings-json.ts";

type Sql = Prisma.TransactionClient;

/** The transaction of the unit of work currently running (set by createDbPorts' uow.run). */
export const activeUnit = new AsyncLocalStorage<{ readonly ws: WorkspaceId; readonly db: Sql }>();

/** The running unit's transaction when it belongs to `ws`, else the plain client. */
const sqlFor = (prisma: PrismaClient, ws: WorkspaceId): Sql => {
  const unit = activeUnit.getStore();
  return unit !== undefined && unit.ws === ws ? unit.db : prisma;
};

type ConfigModule = "shop" | "stickers" | "levels" | "milestones" | "pairing";

async function readConfig<T>(db: Sql, ws: WorkspaceId, module: ConfigModule, fallback: T): Promise<T> {
  const [row] = await db.$queryRaw<{ data: T }[]>`SELECT data FROM module_config WHERE workspace_id = ${ws} AND module = ${module}`;
  return row?.data ?? fallback;
}

async function putConfig(db: Sql, ws: WorkspaceId, module: ConfigModule, data: unknown): Promise<void> {
  await db.$executeRaw`
    INSERT INTO module_config (workspace_id, module, data) VALUES (${ws}, ${module}, ${toJson(data)}::jsonb)
    ON CONFLICT (workspace_id, module) DO UPDATE SET data = EXCLUDED.data`;
}

/** A compare-and-set write must change exactly one row. */
function expectOne(changed: number, what: string): void {
  if (changed !== 1) throw new Error(`compare-and-set failed: ${what}`);
}

// ───────────── Shop reads ─────────────

interface RewardRow {
  id: string;
  status: Reward["status"];
  stock: number | null;
  data: Omit<Reward, "id" | "status" | "stock" | "variants" | "createdAt">;
  created_at: Date;
  variants: RewardVariant[];
}

const REWARD_SELECT = Prisma.sql`
  SELECT r.id, r.status, r.stock, r.data, r.created_at,
         COALESCE((SELECT json_agg(json_build_object('id', v.id, 'name', v.name, 'stock', v.stock) ORDER BY v.position)
                   FROM reward_variant v WHERE v.workspace_id = r.workspace_id AND v.reward_id = r.id), '[]'::json) AS variants
  FROM reward r`;

const toReward = (r: RewardRow): Reward => ({
  ...r.data,
  id: r.id,
  status: r.status,
  stock: r.stock,
  variants: r.variants,
  createdAt: r.created_at.getTime() as Reward["createdAt"],
});

const toRedemption = (r: { data: Redemption; state: Redemption["state"] }): Redemption => ({ ...r.data, state: r.state });
const toCollab = (r: { data: Collab; phase: Collab["phase"] }): Collab => ({ ...r.data, phase: r.phase });

export function shopReader(db: Sql, ws: WorkspaceId, giftCards: GiftCardProvider | null): ShopReader {
  const redemptionsWhere = async (where: Prisma.Sql) =>
    (await db.$queryRaw<{ data: Redemption; state: Redemption["state"] }[]>`
      SELECT data, state FROM redemption WHERE workspace_id = ${ws} AND ${where} ORDER BY seq`).map(toRedemption);

  return {
    shopSettings: () => readConfig<ShopSettings>(db, ws, "shop", DEFAULT_SHOP_SETTINGS),

    async reward(id) {
      const [row] = await db.$queryRaw<RewardRow[]>`${REWARD_SELECT} WHERE r.workspace_id = ${ws} AND r.id = ${id}`;
      return row ? toReward(row) : null;
    },
    async rewards() {
      return (await db.$queryRaw<RewardRow[]>`${REWARD_SELECT} WHERE r.workspace_id = ${ws} ORDER BY r.seq`).map(toReward);
    },

    async redemption(id) {
      const [row] = await redemptionsWhere(Prisma.sql`id = ${id}`);
      return row ?? null;
    },
    redemptions: () => redemptionsWhere(Prisma.sql`true`),

    // S47 and S108 reuse the core folds over the candidate rows, so both stores count the same way.
    async budgetSpent(month) {
      return budgetSpent(await redemptionsWhere(Prisma.sql`budget_month = ${month}`), month);
    },
    async prepaidAvailable() {
      if (giftCards === null) return null;
      const balance = await giftCards.prepaidBalance(ws);
      const reserved = prepaidReserved(await redemptionsWhere(Prisma.sql`gift_card AND NOT card_issued`));
      return { minor: balance.minor - reserved, currency: balance.currency };
    },

    async collab(id) {
      const [row] = await db.$queryRaw<{ data: Collab; phase: Collab["phase"] }[]>`
        SELECT data, phase FROM collab WHERE workspace_id = ${ws} AND id = ${id}`;
      return row ? toCollab(row) : null;
    },

    // S56: spend adds, refund removes; members appear in first-contribution order.
    async contributions(id) {
      const rows = await db.$queryRaw<{ member_id: string; net: bigint }[]>`
        SELECT member_id, (-SUM(amount))::bigint AS net FROM ledger_entry
        WHERE workspace_id = ${ws} AND cause_type = 'contribution' AND cause_id = ${id}
        GROUP BY member_id ORDER BY MIN(seq)`;
      return new Map(rows.map((r) => [r.member_id as MemberId, safeNumber(r.net)]));
    },
  };
}

// ───────────── Module writes ─────────────

type EngagementWrite = RuleWrite | QuestWrite | Exclude<StickerWrite, { t: "gift.upsert" }> | LevelWrite | MilestoneWrite | PairingWrite;
export type ModuleWrite = ShopWrite | EngagementWrite;

const rewardData = (r: Reward) => {
  const { id: _id, status: _status, stock: _stock, variants: _variants, createdAt: _createdAt, ...data } = r;
  return data;
};

async function bumpStock(db: Sql, ws: WorkspaceId, w: Extract<ShopWrite, { t: "shop.stock.take" | "shop.stock.add" }>): Promise<void> {
  const delta = w.t === "shop.stock.take" ? -1 : w.quantity;
  // NULL stock is unlimited and stays NULL; a take on 0 changes no row (the conditional decrement).
  const changed =
    w.variantId === null
      ? await db.$executeRaw`
          UPDATE reward SET stock = stock + ${delta}
          WHERE workspace_id = ${ws} AND id = ${w.rewardId} AND (stock IS NULL OR stock + ${delta} >= 0)`
      : await db.$executeRaw`
          UPDATE reward_variant SET stock = stock + ${delta}
          WHERE workspace_id = ${ws} AND reward_id = ${w.rewardId} AND id = ${w.variantId} AND (stock IS NULL OR stock + ${delta} >= 0)`;
  expectOne(changed, `reward ${w.rewardId}${w.variantId === null ? "" : `/${w.variantId}`} is out of stock or missing`);
}

/** One applier per module write kind (exhaustive: a new kind fails to compile here). */
export const MODULE_APPLIERS: { readonly [K in ModuleWrite["t"]]: (db: Sql, ws: WorkspaceId, w: Extract<ModuleWrite, { t: K }>) => Promise<void> } = {
  // ── Shop ──
  "shop.settings.put": (db, ws, w) => putConfig(db, ws, "shop", w.settings),

  async "shop.reward.insert"(db, ws, { reward: r }) {
    const inserted = await db.$executeRaw`
      INSERT INTO reward (workspace_id, id, status, stock, data, created_at)
      VALUES (${ws}, ${r.id}, ${r.status}, ${r.stock}, ${toJson(rewardData(r))}::jsonb, ${new Date(r.createdAt)})
      ON CONFLICT (workspace_id, id) DO NOTHING`;
    expectOne(inserted, `reward ${r.id} already exists`);
    for (const [position, v] of r.variants.entries()) {
      await db.$executeRaw`
        INSERT INTO reward_variant (workspace_id, reward_id, id, name, stock, position)
        VALUES (${ws}, ${r.id}, ${v.id}, ${v.name}, ${v.stock}, ${position})`;
    }
  },

  async "shop.reward.status"(db, ws, w) {
    const changed = await db.$executeRaw`
      UPDATE reward SET status = ${w.to} WHERE workspace_id = ${ws} AND id = ${w.rewardId} AND status = ${w.from}`;
    expectOne(changed, `reward ${w.rewardId} is not ${w.from}`);
  },

  // Field edits only: stock and variants change through Restock and redemptions.
  async "shop.reward.update"(db, ws, { from, reward: r }) {
    const changed = await db.$executeRaw`
      UPDATE reward SET status = ${r.status}, data = ${toJson(rewardData(r))}::jsonb
      WHERE workspace_id = ${ws} AND id = ${r.id} AND status = ${from}`;
    expectOne(changed, `reward ${r.id} is not ${from}`);
  },

  "shop.stock.take": bumpStock,
  "shop.stock.add": bumpStock,

  async "shop.redemption.put"(db, ws, { from, redemption: r }) {
    const data = toJson(r);
    const changed =
      from === null
        ? await db.$executeRaw`
            INSERT INTO redemption (workspace_id, id, state, member_id, reward_id, collab_id, budget_month, gift_card, card_issued, data)
            VALUES (${ws}, ${r.id}, ${r.state}, ${r.memberId}, ${r.rewardId}, ${r.collabId}, ${r.budgetMonth}, ${r.giftCard}, ${r.cardIssued}, ${data}::jsonb)
            ON CONFLICT (workspace_id, id) DO NOTHING`
        : await db.$executeRaw`
            UPDATE redemption SET state = ${r.state}, budget_month = ${r.budgetMonth}, card_issued = ${r.cardIssued}, data = ${data}::jsonb
            WHERE workspace_id = ${ws} AND id = ${r.id} AND state = ${from}`;
    expectOne(changed, `redemption ${r.id} is not ${from ?? "missing"}`);
  },

  async "shop.collab.put"(db, ws, { from, collab: c }) {
    const data = toJson(c);
    const changed =
      from === null
        ? await db.$executeRaw`
            INSERT INTO collab (workspace_id, id, phase, data) VALUES (${ws}, ${c.id}, ${c.phase}, ${data}::jsonb)
            ON CONFLICT (workspace_id, id) DO NOTHING`
        : await db.$executeRaw`
            UPDATE collab SET phase = ${c.phase}, data = ${data}::jsonb WHERE workspace_id = ${ws} AND id = ${c.id} AND phase = ${from}`;
    expectOne(changed, `collab ${c.id} is not ${from ?? "missing"}`);
  },

  // ── Engagement (upserts and appends, as in app/testing/engagement.ts) ──
  async "rule.upsert"(db, ws, { rule }) {
    await db.$executeRaw`
      INSERT INTO award_rule (workspace_id, id, data) VALUES (${ws}, ${rule.id}, ${toJson(rule)}::jsonb)
      ON CONFLICT (workspace_id, id) DO UPDATE SET data = EXCLUDED.data`;
  },
  async "quest.upsert"(db, ws, { quest }) {
    await db.$executeRaw`
      INSERT INTO quest (workspace_id, id, data) VALUES (${ws}, ${quest.id}, ${toJson(quest)}::jsonb)
      ON CONFLICT (workspace_id, id) DO UPDATE SET data = EXCLUDED.data`;
  },
  async "submission.upsert"(db, ws, { submission: s }) {
    await db.$executeRaw`
      INSERT INTO quest_submission (workspace_id, id, quest_id, data) VALUES (${ws}, ${s.id}, ${s.questId}, ${toJson(s)}::jsonb)
      ON CONFLICT (workspace_id, id) DO UPDATE SET quest_id = EXCLUDED.quest_id, data = EXCLUDED.data`;
  },
  async "quest.comment"(db, ws, { comment }) {
    await db.$executeRaw`
      INSERT INTO quest_comment (workspace_id, submission_id, data) VALUES (${ws}, ${comment.submissionId}, ${toJson(comment)}::jsonb)`;
  },
  "sticker.config": (db, ws, w) => putConfig(db, ws, "stickers", w.config),
  async "sticker.upsert"(db, ws, { sticker }) {
    await db.$executeRaw`
      INSERT INTO sticker (workspace_id, id, data) VALUES (${ws}, ${sticker.id}, ${toJson(sticker)}::jsonb)
      ON CONFLICT (workspace_id, id) DO UPDATE SET data = EXCLUDED.data`;
  },
  async "sticker.grant"(db, ws, { grant: g }) {
    await db.$executeRaw`
      INSERT INTO sticker_grant (workspace_id, member_id, sticker_id, month, uses) VALUES (${ws}, ${g.memberId}, ${g.stickerId}, ${g.month}, ${g.uses})`;
  },
  async "sticker.used"(db, ws, { use: u }) {
    await db.$executeRaw`
      INSERT INTO sticker_use (workspace_id, gift_id, sticker_id, giver_id, month) VALUES (${ws}, ${u.giftId}, ${u.stickerId}, ${u.giver}, ${u.month})`;
  },
  "levels.config": (db, ws, w) => putConfig(db, ws, "levels", w.config),
  async "avatar.choose"(db, ws, w) {
    await db.$executeRaw`
      INSERT INTO member_avatar (workspace_id, member_id, avatar_id) VALUES (${ws}, ${w.memberId}, ${w.avatarId})
      ON CONFLICT (workspace_id, member_id) DO UPDATE SET avatar_id = EXCLUDED.avatar_id`;
  },
  async "milestone.profile"(db, ws, { profile: p }) {
    await db.$executeRaw`
      INSERT INTO milestone_profile (workspace_id, member_id, data) VALUES (${ws}, ${p.memberId}, ${toJson(p)}::jsonb)
      ON CONFLICT (workspace_id, member_id) DO UPDATE SET data = EXCLUDED.data`;
  },
  "milestone.config": (db, ws, w) => putConfig(db, ws, "milestones", w.config),
  "pairing.config": (db, ws, w) => putConfig(db, ws, "pairing", w.config),
  async "pairing.optin"(db, ws, w) {
    await db.$executeRaw`
      INSERT INTO pairing_optin (workspace_id, member_id, opted_in) VALUES (${ws}, ${w.memberId}, ${w.optedIn})
      ON CONFLICT (workspace_id, member_id) DO UPDATE SET opted_in = EXCLUDED.opted_in`;
  },
  async "pairing.round"(db, ws, { record }) {
    await db.$executeRaw`INSERT INTO pairing_round (workspace_id, round, data) VALUES (${ws}, ${record.round}, ${toJson(record)}::jsonb)`;
  },
};

// ───────────── Engagement stores ─────────────

export interface DbEngagementStores {
  readonly rules: RuleStore;
  readonly quests: QuestStore;
  readonly stickers: StickerStore;
  readonly levels: LevelStore;
  readonly milestones: MilestoneStore;
  readonly pairing: PairingStore;
}

/**
 * The engagement read ports over Postgres. Wire them at the composition root:
 *   engagementHandlers({ reader: ports.reader, directory: ports.directory, ...createDbEngagementStores(prisma) })
 */
export function createDbEngagementStores(prisma: PrismaClient): DbEngagementStores {
  const q = (ws: WorkspaceId) => sqlFor(prisma, ws);
  const docs = async <T>(ws: WorkspaceId, query: Prisma.Sql): Promise<T[]> => (await q(ws).$queryRaw<{ data: T }[]>(query)).map((r) => r.data);
  const one = async <T>(ws: WorkspaceId, query: Prisma.Sql): Promise<T | null> => (await docs<T>(ws, query))[0] ?? null;
  const int = async (ws: WorkspaceId, query: Prisma.Sql): Promise<number> => (await q(ws).$queryRaw<{ n: number }[]>(query))[0]?.n ?? 0;

  return {
    rules: {
      rules: (ws) => docs<AwardRule>(ws, Prisma.sql`SELECT data FROM award_rule WHERE workspace_id = ${ws} ORDER BY seq`),
      rule: (ws, id) => one<AwardRule>(ws, Prisma.sql`SELECT data FROM award_rule WHERE workspace_id = ${ws} AND id = ${id}`),
    },
    quests: {
      quest: (ws, id) => one<Quest>(ws, Prisma.sql`SELECT data FROM quest WHERE workspace_id = ${ws} AND id = ${id}`),
      quests: (ws) => docs<Quest>(ws, Prisma.sql`SELECT data FROM quest WHERE workspace_id = ${ws} ORDER BY seq`),
      submission: (ws, id) => one<Submission>(ws, Prisma.sql`SELECT data FROM quest_submission WHERE workspace_id = ${ws} AND id = ${id}`),
      submissions: (ws, questId) =>
        docs<Submission>(ws, Prisma.sql`SELECT data FROM quest_submission WHERE workspace_id = ${ws} AND quest_id = ${questId} ORDER BY seq`),
      comments: (ws, submissionId) =>
        docs<QuestComment>(ws, Prisma.sql`SELECT data FROM quest_comment WHERE workspace_id = ${ws} AND submission_id = ${submissionId} ORDER BY seq`),
    },
    stickers: {
      config: (ws) => readConfig<StickerConfig>(q(ws), ws, "stickers", STICKERS_OFF),
      sticker: (ws, id) => one<StickerDef>(ws, Prisma.sql`SELECT data FROM sticker WHERE workspace_id = ${ws} AND id = ${id}`),
      stickers: (ws) => docs<StickerDef>(ws, Prisma.sql`SELECT data FROM sticker WHERE workspace_id = ${ws} ORDER BY seq`),
      granted: (ws, member, stickerId, month) =>
        int(ws, Prisma.sql`
          SELECT COALESCE(SUM(uses), 0)::int AS n FROM sticker_grant
          WHERE workspace_id = ${ws} AND member_id = ${member} AND sticker_id = ${stickerId} AND month = ${month}`),
      used: (ws, member, stickerId, month) =>
        int(ws, Prisma.sql`
          SELECT COUNT(*)::int AS n FROM sticker_use
          WHERE workspace_id = ${ws} AND giver_id = ${member} AND sticker_id = ${stickerId} AND month = ${month}`),
    },
    levels: {
      config: (ws) => readConfig<LevelConfig>(q(ws), ws, "levels", DEFAULT_LEVEL_CONFIG),
      async avatar(ws, member) {
        const [row] = await q(ws).$queryRaw<{ avatar_id: string }[]>`
          SELECT avatar_id FROM member_avatar WHERE workspace_id = ${ws} AND member_id = ${member}`;
        return row?.avatar_id ?? null;
      },
    },
    milestones: {
      config: (ws) => readConfig<MilestoneConfig>(q(ws), ws, "milestones", DEFAULT_MILESTONES),
      profile: (ws, member) => one<MilestoneProfile>(ws, Prisma.sql`SELECT data FROM milestone_profile WHERE workspace_id = ${ws} AND member_id = ${member}`),
      profiles: (ws) => docs<MilestoneProfile>(ws, Prisma.sql`SELECT data FROM milestone_profile WHERE workspace_id = ${ws} ORDER BY seq`),
    },
    pairing: {
      config: (ws) => readConfig<PairingConfig>(q(ws), ws, "pairing", DEFAULT_PAIRING),
      async optedIn(ws) {
        const rows = await q(ws).$queryRaw<{ member_id: string }[]>`
          SELECT member_id FROM pairing_optin WHERE workspace_id = ${ws} AND opted_in ORDER BY member_id COLLATE "C"`;
        return rows.map((r) => r.member_id as MemberId);
      },
      rounds: (ws) => docs<PairingRound>(ws, Prisma.sql`SELECT data FROM pairing_round WHERE workspace_id = ${ws} ORDER BY seq`),
    },
  };
}

// ───────────── Identities (S107) ─────────────

interface IdentityRow {
  workspace_id: string;
  platform: PlatformIdentity["platform"];
  platform_team_id: string;
  platform_user_id: string;
  member_id: string;
}

const toIdentity = (r: IdentityRow): PlatformIdentity => ({
  workspaceId: r.workspace_id as WorkspaceId,
  platform: r.platform,
  tenantId: r.platform_team_id,
  userId: r.platform_user_id,
  memberId: r.member_id as MemberId,
});

/** The `identity` table; its primary key keeps (workspace, platform, tenant, user) unique. */
export function createDbIdentityStore(prisma: PrismaClient): IdentityStore {
  const q = (ws: WorkspaceId) => sqlFor(prisma, ws);
  return {
    async find(ws, ref) {
      const [row] = await q(ws).$queryRaw<IdentityRow[]>`
        SELECT workspace_id, platform, platform_team_id, platform_user_id, member_id FROM identity
        WHERE workspace_id = ${ws} AND platform = ${ref.platform} AND platform_team_id = ${ref.tenantId} AND platform_user_id = ${ref.userId}`;
      return row ? toIdentity(row) : null;
    },
    async list(ws) {
      const rows = await q(ws).$queryRaw<IdentityRow[]>`
        SELECT workspace_id, platform, platform_team_id, platform_user_id, member_id FROM identity
        WHERE workspace_id = ${ws} ORDER BY platform, platform_team_id, platform_user_id`;
      return rows.map(toIdentity);
    },
    async insert(i) {
      await q(i.workspaceId).$executeRaw`
        INSERT INTO identity (workspace_id, platform, platform_team_id, platform_user_id, member_id)
        VALUES (${i.workspaceId}, ${i.platform}, ${i.tenantId}, ${i.userId}, ${i.memberId})`;
    },
  };
}
