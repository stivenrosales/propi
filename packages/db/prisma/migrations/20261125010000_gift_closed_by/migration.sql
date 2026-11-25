-- A gift becomes final once an admin reverses it (S38) or its message is deleted the same
-- allowance day (S24). Edits and re-added reactions never re-gift a closed gift (S23).
ALTER TABLE "gift" ADD COLUMN "closed_by" TEXT CHECK ("closed_by" IN ('admin', 'message_deleted'));
