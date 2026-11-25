-- S6, S7: billing. Additive only: two new tables and one new column with a default; no existing row
-- changes meaning (every workspace starts not comped, with no subscription, i.e. on the Free plan).

-- Comped workspaces are treated as Pro and never billed (S7).
ALTER TABLE "workspace" ADD COLUMN "comped" BOOLEAN NOT NULL DEFAULT false;

-- One paid subscription per workspace, as last reported by the billing provider (Polar).
CREATE TABLE "subscription" (
  "workspace_id"        TEXT PRIMARY KEY REFERENCES "workspace" ("id"),
  "provider"            TEXT NOT NULL,
  "subscription_id"     TEXT NOT NULL,
  "customer_id"         TEXT,
  "status"              TEXT NOT NULL,
  "current_period_end"  TIMESTAMPTZ(3),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "seats"               INTEGER,
  "source_updated_at"   TIMESTAMPTZ(3) NOT NULL,
  "updated_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "subscription_provider_idx" ON "subscription" ("provider", "subscription_id");

-- Webhook idempotency: each provider event is processed once (S6).
CREATE TABLE "billing_event" (
  "provider"     TEXT NOT NULL,
  "event_id"     TEXT NOT NULL,
  "type"         TEXT NOT NULL,
  "workspace_id" TEXT REFERENCES "workspace" ("id"),
  "received_at"  TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("provider", "event_id")
);
