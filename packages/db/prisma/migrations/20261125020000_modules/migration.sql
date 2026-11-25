-- Module state for the shop (S44-S59, S108) and the engagement modules (S60-S79, S92-S96).
-- Shop rows that move money are compare-and-set: the adapter updates them with
-- `WHERE state = <from>` / `WHERE stock > 0` and fails the transaction when 0 rows change.
-- Aggregates keep their full shape in `data` (JSONB); the columns the adapter filters,
-- compares or constrains on are real columns. `seq` keeps insertion order (memory Map order).

-- ───────────── Per-module configuration (shop, stickers, levels, milestones, pairing) ─────────────

CREATE TABLE "module_config" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "module"       TEXT NOT NULL CHECK ("module" IN ('shop', 'stickers', 'levels', 'milestones', 'pairing')),
  "data"         JSONB NOT NULL,
  PRIMARY KEY ("workspace_id", "module")
);

-- ───────────── Shop ─────────────

-- S44-S46. `stock` NULL = unlimited; it never goes below 0 (S46, StockConserved).
CREATE TABLE "reward" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "id"           TEXT NOT NULL,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "status"       TEXT NOT NULL CHECK ("status" IN ('draft', 'active', 'archived')),
  "stock"        INTEGER CHECK ("stock" >= 0),
  "data"         JSONB NOT NULL,
  "created_at"   TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("workspace_id", "id")
);

CREATE TABLE "reward_variant" (
  "workspace_id" TEXT NOT NULL,
  "reward_id"    TEXT NOT NULL,
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "stock"        INTEGER CHECK ("stock" >= 0),
  "position"     INTEGER NOT NULL,
  PRIMARY KEY ("workspace_id", "reward_id", "id"),
  FOREIGN KEY ("workspace_id", "reward_id") REFERENCES "reward" ("workspace_id", "id")
);

-- S49-S55, S108. Legal edges are enforced by the CAS on `state` (docs/statecharts/redemption).
CREATE TABLE "redemption" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "id"           TEXT NOT NULL,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "state"        TEXT NOT NULL CHECK ("state" IN ('pending', 'approved', 'fulfilled', 'rejected', 'cancelled')),
  "member_id"    TEXT,
  "reward_id"    TEXT,
  "collab_id"    TEXT,
  "budget_month" TEXT,
  "gift_card"    BOOLEAN NOT NULL,
  "card_issued"  BOOLEAN NOT NULL,
  "data"         JSONB NOT NULL,
  PRIMARY KEY ("workspace_id", "id")
);
CREATE INDEX "redemption_budget_idx" ON "redemption" ("workspace_id", "budget_month");
CREATE INDEX "redemption_prepaid_idx" ON "redemption" ("workspace_id") WHERE "gift_card" AND NOT "card_issued";
-- OneGroupRedemption (docs/statecharts/collab): a collab completes into exactly one redemption.
CREATE UNIQUE INDEX "redemption_one_per_collab" ON "redemption" ("workspace_id", "collab_id") WHERE "collab_id" IS NOT NULL;

-- S56-S59. Contributions are ledger entries (cause_type 'contribution'); this is the header.
CREATE TABLE "collab" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "id"           TEXT NOT NULL,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "phase"        TEXT NOT NULL CHECK ("phase" IN ('open', 'completed', 'delivered', 'refunded')),
  "data"         JSONB NOT NULL,
  PRIMARY KEY ("workspace_id", "id")
);

-- ───────────── Rules (S60-S63) ─────────────

CREATE TABLE "award_rule" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "id"           TEXT NOT NULL,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "data"         JSONB NOT NULL,
  PRIMARY KEY ("workspace_id", "id")
);

-- ───────────── Quests (S64-S68) ─────────────

CREATE TABLE "quest" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "id"           TEXT NOT NULL,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "data"         JSONB NOT NULL,
  PRIMARY KEY ("workspace_id", "id")
);

CREATE TABLE "quest_submission" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "id"           TEXT NOT NULL,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "quest_id"     TEXT NOT NULL,
  "data"         JSONB NOT NULL,
  PRIMARY KEY ("workspace_id", "id")
);
CREATE INDEX "quest_submission_quest_idx" ON "quest_submission" ("workspace_id", "quest_id", "seq");

CREATE TABLE "quest_comment" (
  "seq"           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "workspace_id"  TEXT NOT NULL REFERENCES "workspace" ("id"),
  "submission_id" TEXT NOT NULL,
  "data"          JSONB NOT NULL
);
CREATE INDEX "quest_comment_submission_idx" ON "quest_comment" ("workspace_id", "submission_id", "seq");

-- ───────────── Stickers (S73-S76) ─────────────

CREATE TABLE "sticker" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "id"           TEXT NOT NULL,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "data"         JSONB NOT NULL,
  PRIMARY KEY ("workspace_id", "id")
);

-- S76: extra uses; several grants for the same month add up.
CREATE TABLE "sticker_grant" (
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "member_id"    TEXT NOT NULL,
  "sticker_id"   TEXT NOT NULL,
  "month"        TEXT NOT NULL,
  "uses"         INTEGER NOT NULL CHECK ("uses" >= 1)
);
CREATE INDEX "sticker_grant_idx" ON "sticker_grant" ("workspace_id", "member_id", "sticker_id", "month");

-- S75: one row per sticker gift, counted against the giver's monthly quota.
CREATE TABLE "sticker_use" (
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "gift_id"      TEXT NOT NULL,
  "sticker_id"   TEXT NOT NULL,
  "giver_id"     TEXT NOT NULL,
  "month"        TEXT NOT NULL
);
CREATE INDEX "sticker_use_idx" ON "sticker_use" ("workspace_id", "giver_id", "sticker_id", "month");

-- ───────────── Levels (S77-S79), milestones (S92-S94), pairing (S95-S96) ─────────────

CREATE TABLE "member_avatar" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "member_id"    TEXT NOT NULL,
  "avatar_id"    TEXT NOT NULL,
  PRIMARY KEY ("workspace_id", "member_id")
);

CREATE TABLE "milestone_profile" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "member_id"    TEXT NOT NULL,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "data"         JSONB NOT NULL,
  PRIMARY KEY ("workspace_id", "member_id")
);

CREATE TABLE "pairing_optin" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "member_id"    TEXT NOT NULL,
  "opted_in"     BOOLEAN NOT NULL,
  PRIMARY KEY ("workspace_id", "member_id")
);

CREATE TABLE "pairing_round" (
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "round"        TEXT NOT NULL,
  "data"         JSONB NOT NULL
);
CREATE INDEX "pairing_round_idx" ON "pairing_round" ("workspace_id", "seq");
