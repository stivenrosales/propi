// G1: every SQL fragment that depends on what an entry kind moves is generated from core EFFECTS,
// so replay(), the SQL aggregates and the CHECK constraints cannot drift apart.
import { EFFECTS, type EntryKind } from "@propi/core";

const KINDS = Object.keys(EFFECTS) as EntryKind[];

const list = (kinds: readonly EntryKind[]): string => kinds.map((k) => `'${k}'`).join(", ");

/** Kinds that move `received` (S31) and, through counterpart_id, `given` (S33) and allowance (S19). */
export const RECEIVED_KINDS = KINDS.filter((k) => EFFECTS[k].received);
export const GIVEN_KINDS = KINDS.filter((k) => EFFECTS[k].given);
export const REDEEMABLE_KINDS = KINDS.filter((k) => EFFECTS[k].redeemable);

/** SQL `IN (...)` lists, inlined as trusted constants. */
export const SQL_LISTS = {
  all: list(KINDS),
  received: list(RECEIVED_KINDS),
  given: list(GIVEN_KINDS),
  redeemable: list(REDEEMABLE_KINDS),
} as const;

/**
 * The per-kind sign constraints of ledger_entry, exactly as the migration declares them.
 * A test asserts the migration contains every one of these statements verbatim.
 */
export function ledgerCheckConstraints(): string[] {
  return [
    `ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_kind_known" CHECK ("kind" IN (${SQL_LISTS.all}));`,
    `ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_amount_nonzero" CHECK ("amount" <> 0);`,
    ...KINDS.map(
      (k) => `ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_sign_${k}" CHECK ("kind" <> '${k}' OR "amount" ${EFFECTS[k].sign > 0 ? ">" : "<"} 0);`,
    ),
  ];
}
