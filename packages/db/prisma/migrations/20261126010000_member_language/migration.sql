-- i18n S3, S4c: a member's own language ("en" | "es"; NULL = automatic) and their Slack locale as
-- Slack reports it (users.info `locale`). Additive and nullable: existing members read as automatic
-- with no Slack locale until the next Slack sync. The workspace default language lives in
-- workspace.settings JSON (no column).
ALTER TABLE "member" ADD COLUMN "language" TEXT;
ALTER TABLE "member" ADD COLUMN "slack_locale" TEXT;
