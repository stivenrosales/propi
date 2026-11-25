-- S6: a member's display name and avatar, copied from their Slack profile. Additive and nullable:
-- existing members keep every value and read as "no profile yet" until the next Slack sync.
ALTER TABLE "member" ADD COLUMN "display_name" TEXT;
ALTER TABLE "member" ADD COLUMN "avatar_url" TEXT;
