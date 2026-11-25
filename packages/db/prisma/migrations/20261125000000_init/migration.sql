-- Propi initial schema: workspace, people, gifts, the append-only ledger, the command log and the outbox.
-- Architecture §1 (ledger model), §1.4 (owners), §1.7 (command_log), §1.8 (append-only), §6 (outbox), G1, G2, G10.
-- Later modules add tables additively in new migrations.

-- ───────────── Workspace and people ─────────────

CREATE TABLE "workspace" (
  "id"         TEXT PRIMARY KEY,
  "settings"   JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "member" (
  "workspace_id"         TEXT NOT NULL REFERENCES "workspace" ("id"),
  "id"                   TEXT NOT NULL,
  "role"                 TEXT NOT NULL CHECK ("role" IN ('admin', 'approver', 'member')),
  "active"               BOOLEAN NOT NULL DEFAULT true,
  "daily_limit_override" INTEGER CHECK ("daily_limit_override" >= 1),
  "created_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "id")
);

-- S107: one member, many platform identities.
CREATE TABLE "identity" (
  "workspace_id"     TEXT NOT NULL,
  "platform"         TEXT NOT NULL,
  "platform_team_id" TEXT NOT NULL,
  "platform_user_id" TEXT NOT NULL,
  "member_id"        TEXT NOT NULL,
  "email"            TEXT,
  PRIMARY KEY ("workspace_id", "platform", "platform_team_id", "platform_user_id"),
  FOREIGN KEY ("workspace_id", "member_id") REFERENCES "member" ("workspace_id", "id")
);
CREATE INDEX "identity_member_idx" ON "identity" ("workspace_id", "member_id");

-- S41: company values, in definition order.
CREATE TABLE "value" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "hashtag"      TEXT,
  "emoji"        TEXT,
  "position"     INTEGER NOT NULL,
  PRIMARY KEY ("workspace_id", "id")
);

-- ───────────── Gifts ─────────────

-- Gift header: one row per gift (message, reaction or sticker). Text is rewritten on edit (S23).
-- giver_id has no FK: bot givers use a synthetic id "bot:<platform user>" (S8).
CREATE TABLE "gift" (
  "workspace_id"  TEXT NOT NULL REFERENCES "workspace" ("id"),
  "id"            TEXT NOT NULL,
  "seq"           BIGINT GENERATED ALWAYS AS IDENTITY,
  "giver_id"      TEXT NOT NULL,
  "message_ref"   TEXT,
  "source"        TEXT NOT NULL CHECK ("source" IN ('message', 'reaction', 'sticker')),
  "emoji"         TEXT,
  "channel_id"    TEXT NOT NULL,
  "is_private"    BOOLEAN NOT NULL,
  "text"          TEXT,
  "allowance_day" DATE,
  "created_at"    TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("workspace_id", "id")
);
CREATE INDEX "gift_message_idx" ON "gift" ("workspace_id", "message_ref", "source");
-- A platform message carries at most one message gift (edits rewrite it, S23).
CREATE UNIQUE INDEX "gift_one_per_message" ON "gift" ("workspace_id", "message_ref") WHERE "source" = 'message';

CREATE TABLE "gift_value" (
  "workspace_id" TEXT NOT NULL,
  "gift_id"      TEXT NOT NULL,
  "value_id"     TEXT NOT NULL,
  "ordinal"      INTEGER NOT NULL,
  PRIMARY KEY ("workspace_id", "gift_id", "value_id"),
  FOREIGN KEY ("workspace_id", "gift_id") REFERENCES "gift" ("workspace_id", "id")
);

-- ───────────── Command log (G2, §1.7) ─────────────

-- One row per command key: idempotency record, stored result and audit trail (S17, S40).
-- A row is claimed as 'running' and completed once, in the same transaction; after that it never changes.
CREATE TABLE "command_log" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "key"          TEXT NOT NULL,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "request_hash" TEXT NOT NULL,
  "status"       TEXT NOT NULL CHECK ("status" IN ('running', 'done')),
  "command_type" TEXT,
  "actor"        JSONB,
  "command"      JSONB,
  "result"       JSONB,
  "at"           TIMESTAMPTZ(3),
  PRIMARY KEY ("workspace_id", "key"),
  CONSTRAINT "command_log_done_is_complete" CHECK (
    "status" = 'running'
    OR ("command_type" IS NOT NULL AND "actor" IS NOT NULL AND "command" IS NOT NULL AND "result" IS NOT NULL AND "at" IS NOT NULL)
  )
);
CREATE INDEX "command_log_seq_idx" ON "command_log" ("workspace_id", "seq");

-- ───────────── Ledger (§1.1, S30) ─────────────

-- amount is signed; its sign is fixed by kind through the CHECKs below, generated from core EFFECTS (G1).
CREATE TABLE "ledger_entry" (
  "seq"            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "workspace_id"   TEXT NOT NULL,
  "command_key"    TEXT NOT NULL,
  "ordinal"        INTEGER NOT NULL,
  "kind"           TEXT NOT NULL,
  "amount"         INTEGER NOT NULL,
  "member_id"      TEXT NOT NULL,
  "counterpart_id" TEXT,
  "cause_type"     TEXT NOT NULL,
  "cause_id"       TEXT,
  "cause"          JSONB NOT NULL,
  "source"         TEXT CHECK ("source" IN ('message', 'reaction', 'sticker')),
  "allowance_day"  DATE,
  "at"             TIMESTAMPTZ(3) NOT NULL,
  "reason"         TEXT,
  CONSTRAINT "ledger_entry_command_ordinal_key" UNIQUE ("workspace_id", "command_key", "ordinal"),
  FOREIGN KEY ("workspace_id", "command_key") REFERENCES "command_log" ("workspace_id", "key"),
  FOREIGN KEY ("workspace_id", "member_id") REFERENCES "member" ("workspace_id", "id")
);

-- G1: generated by ledgerCheckConstraints() in packages/db/src/effects-sql.ts (a test keeps them equal).
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_kind_known" CHECK ("kind" IN ('gift', 'gift_reversal', 'bonus', 'rule_award', 'quest_reward', 'spend', 'refund', 'deduction'));
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_sign_gift" CHECK ("kind" <> 'gift' OR "amount" > 0);
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_sign_gift_reversal" CHECK ("kind" <> 'gift_reversal' OR "amount" < 0);
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_sign_bonus" CHECK ("kind" <> 'bonus' OR "amount" > 0);
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_sign_rule_award" CHECK ("kind" <> 'rule_award' OR "amount" > 0);
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_sign_quest_reward" CHECK ("kind" <> 'quest_reward' OR "amount" > 0);
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_sign_spend" CHECK ("kind" <> 'spend' OR "amount" < 0);
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_sign_refund" CHECK ("kind" <> 'refund' OR "amount" > 0);
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_sign_deduction" CHECK ("kind" <> 'deduction' OR "amount" < 0);

-- §1.3: indexed sums instead of stored projections.
CREATE INDEX "ledger_entry_member_idx" ON "ledger_entry" ("workspace_id", "member_id");
CREATE INDEX "ledger_entry_allowance_idx" ON "ledger_entry" ("workspace_id", "counterpart_id", "allowance_day");
CREATE INDEX "ledger_entry_at_idx" ON "ledger_entry" ("workspace_id", "at");
CREATE INDEX "ledger_entry_cause_idx" ON "ledger_entry" ("workspace_id", "cause_type", "cause_id");

-- ───────────── Outbox (§6) ─────────────

CREATE TABLE "domain_event" (
  "id"           TEXT PRIMARY KEY,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "workspace_id" TEXT NOT NULL,
  "command_key"  TEXT NOT NULL,
  "ordinal"      INTEGER NOT NULL,
  "type"         TEXT NOT NULL,
  "payload"      JSONB NOT NULL,
  "at"           TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "domain_event_command_ordinal_key" UNIQUE ("workspace_id", "command_key", "ordinal"),
  FOREIGN KEY ("workspace_id", "command_key") REFERENCES "command_log" ("workspace_id", "key")
);
CREATE INDEX "domain_event_seq_idx" ON "domain_event" ("workspace_id", "seq");

-- Delivery state of each event per destination (webhook endpoint, member DM, channel post).
CREATE TABLE "delivery" (
  "id"              TEXT PRIMARY KEY,
  "event_id"        TEXT NOT NULL REFERENCES "domain_event" ("id"),
  "destination"     TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'done', 'dead')),
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "last_error"      TEXT,
  CONSTRAINT "delivery_event_destination_key" UNIQUE ("event_id", "destination")
);
CREATE INDEX "delivery_pending_idx" ON "delivery" ("next_attempt_at") WHERE "status" = 'pending';

-- ───────────── Append-only enforcement (§1.8, S30) ─────────────

CREATE FUNCTION "propi_reject_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'propi: % is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

-- command_log allows exactly one change per row: the claim's running -> done completion (G2).
CREATE FUNCTION "propi_command_log_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."status" = 'running' AND NEW."status" = 'done'
     AND NEW."workspace_id" = OLD."workspace_id" AND NEW."key" = OLD."key"
     AND NEW."seq" = OLD."seq" AND NEW."request_hash" = OLD."request_hash" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'propi: command_log is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER "ledger_entry_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entry" FOR EACH ROW EXECUTE FUNCTION "propi_reject_mutation"();
CREATE TRIGGER "ledger_entry_no_truncate"
  BEFORE TRUNCATE ON "ledger_entry" FOR EACH STATEMENT EXECUTE FUNCTION "propi_reject_mutation"();

CREATE TRIGGER "domain_event_append_only"
  BEFORE UPDATE OR DELETE ON "domain_event" FOR EACH ROW EXECUTE FUNCTION "propi_reject_mutation"();
CREATE TRIGGER "domain_event_no_truncate"
  BEFORE TRUNCATE ON "domain_event" FOR EACH STATEMENT EXECUTE FUNCTION "propi_reject_mutation"();

CREATE TRIGGER "command_log_append_only"
  BEFORE UPDATE OR DELETE ON "command_log" FOR EACH ROW EXECUTE FUNCTION "propi_command_log_guard"();
CREATE TRIGGER "command_log_no_truncate"
  BEFORE TRUNCATE ON "command_log" FOR EACH STATEMENT EXECUTE FUNCTION "propi_reject_mutation"();
