// HeyTaco migration: parsed export rows (adapter output), import commands and the import plan (S101-S105).
import type { CommandBase, GiftId, MemberId, PosInt } from "../shared/types.ts";
import type { GiftSource } from "../ledger/entries.ts";

/** One activity CSV row, with header names already resolved by the adapter. */
export interface HeyTacoActivityRow {
  readonly receiverEmail: string;
  readonly giverEmail: string;
  /** Display names; only used to tell apart historical people exported without an email (S102). */
  readonly receiverName?: string;
  readonly giverName?: string;
  /** Wall-clock "YYYY-MM-DD HH:MM:SS" in the export timezone (America/Bogota). */
  readonly timestamp: string;
  readonly channel: string;
  readonly message: string;
  readonly tacos: number;
  readonly tags: string;
  /** "message" | "reaction" | "sticker"; anything else is refused. */
  readonly type: string;
}

/** One users.xlsx row: identity plus HeyTaco's totals, the reconciliation target (S103). */
export interface HeyTacoUserRow {
  readonly uid: string;
  readonly email: string;
  readonly dailyLimit: number;
  readonly given: number;
  readonly received: number;
  readonly bonuses: number;
  readonly redeemable: number;
}

export interface HeyTacoRedemptionRow {
  readonly uid: string;
  readonly email: string;
  readonly timestamp: string;
  readonly title: string;
  readonly amount: number;
  /** HeyTaco's Fulfilled column: boolean, 1/0 or "1"/"0" (S104). */
  readonly fulfilled: boolean | number | string;
}

export interface HeyTacoFile<R> {
  readonly file: string;
  readonly rows: readonly R[];
}

export interface HeyTacoExport {
  readonly users: readonly HeyTacoUserRow[];
  readonly activity: readonly HeyTacoFile<HeyTacoActivityRow>[];
  readonly redemptions: readonly HeyTacoFile<HeyTacoRedemptionRow>[];
}

/** A member already in the workspace, with the identities it can be matched on (S102). */
export interface KnownIdentity {
  readonly memberId: MemberId;
  readonly slackUserId: string | null;
  readonly email: string | null;
}

/** A member the import needs. `isNew` members must be created before the commands run. */
export interface PlannedMember {
  readonly id: MemberId;
  readonly slackUserId: string | null;
  readonly email: string | null;
  /** Current users are active; people who left HeyTaco are imported deactivated (S102). */
  readonly active: boolean;
  readonly dailyLimitOverride: PosInt | null;
  readonly isNew: boolean;
}

export type RedemptionState = "fulfilled" | "approved";

const SYSTEM = { kind: "system", job: "import:heytaco" } as const;
export type ImportActor = typeof SYSTEM;
export const IMPORT_ACTOR: ImportActor = SYSTEM;

export interface ImportHeyTacoGift extends CommandBase {
  readonly type: "ImportHeyTacoGift";
  readonly giftId: GiftId;
  readonly receiver: MemberId;
  readonly giver: MemberId;
  /** As exported; the decider rejects anything but a positive integer. */
  readonly amount: number;
  readonly source: GiftSource;
  readonly channel: string;
  readonly text: string;
  readonly tags: string;
}

export interface ImportHeyTacoRedemption extends CommandBase {
  readonly type: "ImportHeyTacoRedemption";
  readonly redemptionId: string;
  readonly memberId: MemberId;
  readonly amount: number;
  readonly title: string;
  readonly state: RedemptionState;
}

export interface ImportHeyTacoBonus extends CommandBase {
  readonly type: "ImportHeyTacoBonus";
  readonly memberId: MemberId;
  readonly amount: number;
}

export type ImportCommand = ImportHeyTacoGift | ImportHeyTacoRedemption | ImportHeyTacoBonus;

/** HeyTaco's totals for one current user, mapped to the member they reconcile against. */
export interface ExpectedTotals {
  readonly memberId: MemberId;
  readonly received: number;
  readonly given: number;
  readonly redeemable: number;
}

export interface ImportStats {
  readonly activityRows: number;
  /** Rows before the G6 cutoff; equal to activityRows without one. */
  readonly activityInWindow: number;
  readonly activityByType: Readonly<Record<GiftSource, number>>;
  readonly duplicateRowsKept: number;
  readonly redemptionRows: number;
  readonly redemptionInWindow: number;
  readonly redemptionsMatchedByEmailOnly: number;
  readonly redemptionsFulfilled: number;
  readonly redemptionsApproved: number;
  readonly bonusRows: number;
  readonly currentUsers: number;
  readonly historicalMembers: number;
  /** Historical people exported without an email, matched by display name instead (S102). */
  readonly membersWithoutEmail: number;
  readonly matchedExisting: number;
}

export interface ImportPlan {
  /** Members to create, in a deterministic order. Already-known members are not listed. */
  readonly members: readonly PlannedMember[];
  readonly commands: readonly ImportCommand[];
  readonly expected: readonly ExpectedTotals[];
  readonly stats: ImportStats;
}

export interface ImportedGiftResult {
  readonly giftId: GiftId;
  readonly amount: PosInt;
}
export interface ImportedRedemptionResult {
  readonly redemptionId: string;
  readonly state: RedemptionState;
}
export interface ImportedBonusResult {
  readonly memberId: MemberId;
  readonly amount: PosInt;
}
