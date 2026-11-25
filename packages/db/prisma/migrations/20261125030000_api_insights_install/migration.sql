-- API, webhooks, insights configuration and installs.
-- S98 api_token (hash only), S99 webhook_endpoint (secret encrypted at rest with ENCRYPTION_KEY)
-- and delivery (one row per event and endpoint, with backoff state), the outbox consumer receipts
-- for FOR UPDATE SKIP LOCKED claiming (architecture §6), S80-S91 insights settings in module_config,
-- S85 notification preferences, and S5 platform installs (Slack token encrypted at rest).

-- ───────────── API tokens (S98) ─────────────

-- The plaintext token is never stored: `secret_hash` is the SHA-256 hex of it. Revocation is final.
CREATE TABLE "api_token" (
  "id"           TEXT PRIMARY KEY,
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "name"         TEXT NOT NULL,
  "scopes"       TEXT[] NOT NULL,
  "secret_hash"  TEXT NOT NULL CHECK ("secret_hash" ~ '^[0-9a-f]{64}$'),
  "created_at"   TIMESTAMPTZ(3) NOT NULL,
  "created_by"   JSONB NOT NULL,
  "revoked_at"   TIMESTAMPTZ(3)
);
CREATE INDEX "api_token_workspace_idx" ON "api_token" ("workspace_id", "seq");

-- ───────────── Webhook endpoints (S99) ─────────────

-- `secret_enc` is AES-256-GCM ciphertext (src/crypto.ts); `events` is the JSON string "*" or an array.
CREATE TABLE "webhook_endpoint" (
  "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id"),
  "id"           TEXT NOT NULL,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "url"          TEXT NOT NULL,
  "secret_enc"   TEXT NOT NULL,
  "events"       JSONB NOT NULL,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY ("workspace_id", "id")
);

-- ───────────── Outbox public ids and deliveries (S99, §6) ─────────────

-- The webhook event id is a pure function of the outbox position (core webhookEventId):
-- "evt_" + the first 32 hex chars of SHA-256(workspace_id \n command_key \n ordinal), over UTF-8.
-- convert_to is STABLE only because encodings could in theory change; with the fixed 'UTF8'
-- target it is deterministic, so the wrapper is declared IMMUTABLE for the generated column.
CREATE FUNCTION "propi_webhook_event_id"("ws" TEXT, "key" TEXT, "ord" INTEGER) RETURNS TEXT
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT 'evt_' || left(encode(sha256(convert_to("ws" || E'\n' || "key" || E'\n' || "ord"::text, 'UTF8')), 'hex'), 32) $$;

-- Adding a stored generated column rewrites the table without firing the append-only row triggers.
ALTER TABLE "domain_event"
  ADD COLUMN "public_id" TEXT GENERATED ALWAYS AS ("propi_webhook_event_id"("workspace_id", "command_key", "ordinal")) STORED;
CREATE UNIQUE INDEX "domain_event_public_id_key" ON "domain_event" ("public_id");

-- Deliveries point at the public event id and belong to a workspace; `destination` is
-- "webhook:<endpoint id>" for webhooks. The table holds no rows before this migration.
ALTER TABLE "delivery" DROP CONSTRAINT "delivery_event_id_fkey";
ALTER TABLE "delivery" ADD COLUMN "workspace_id" TEXT NOT NULL REFERENCES "workspace" ("id");
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "domain_event" ("public_id");
ALTER TABLE "delivery" ADD COLUMN "seq" BIGINT GENERATED ALWAYS AS IDENTITY;
CREATE INDEX "delivery_workspace_idx" ON "delivery" ("workspace_id", "seq");

-- Outbox consumers (relay, notifier, quest triggers): one receipt per consumer and event, written in
-- the same transaction that claimed the event with FOR NO KEY UPDATE SKIP LOCKED.
CREATE TABLE "outbox_receipt" (
  "consumer"   TEXT NOT NULL,
  "event_id"   TEXT NOT NULL REFERENCES "domain_event" ("id"),
  "handled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("consumer", "event_id")
);

-- ───────────── Insights settings (S69, S80-S91) and notification preferences (S85) ─────────────

ALTER TABLE "module_config" DROP CONSTRAINT "module_config_module_check";
ALTER TABLE "module_config" ADD CONSTRAINT "module_config_module_check"
  CHECK ("module" IN ('shop', 'stickers', 'levels', 'milestones', 'pairing', 'insights'));

CREATE TABLE "notification_preference" (
  "workspace_id" TEXT NOT NULL,
  "member_id"    TEXT NOT NULL,
  "seq"          BIGINT GENERATED ALWAYS AS IDENTITY,
  "prefs"        JSONB NOT NULL,
  PRIMARY KEY ("workspace_id", "member_id"),
  FOREIGN KEY ("workspace_id", "member_id") REFERENCES "member" ("workspace_id", "id")
);

-- ───────────── Platform installs (S5, S72) ─────────────

-- One row per platform tenant (Slack team). `data_enc` is the encrypted installation (bot token);
-- an uninstall only stamps `uninstalled_at` (S72: data is kept).
CREATE TABLE "installation" (
  "platform"       TEXT NOT NULL CHECK ("platform" IN ('slack', 'teams')),
  "tenant_id"      TEXT NOT NULL,
  "workspace_id"   TEXT NOT NULL REFERENCES "workspace" ("id"),
  "data_enc"       TEXT,
  "installed_at"   TIMESTAMPTZ(3) NOT NULL,
  "uninstalled_at" TIMESTAMPTZ(3),
  PRIMARY KEY ("platform", "tenant_id")
);
CREATE INDEX "installation_workspace_idx" ON "installation" ("workspace_id");
