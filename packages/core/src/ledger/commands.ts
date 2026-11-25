// Admin adjustment commands and events (S36-S40).
import type { CommandBase, GiftId, MemberId, PosInt } from "../shared/types.ts";

export interface GrantBonus extends CommandBase {
  readonly type: "GrantBonus";
  readonly memberIds: readonly MemberId[];
  readonly amount: PosInt;
  readonly reason: string;
}
export interface Deduct extends CommandBase {
  readonly type: "Deduct";
  readonly memberId: MemberId;
  readonly amount: PosInt;
  readonly reason: string;
}
export interface ReverseGift extends CommandBase {
  readonly type: "ReverseGift";
  readonly giftId: GiftId;
  readonly reason: string;
}
export interface ResetAllRedeemable extends CommandBase {
  readonly type: "ResetAllRedeemable";
  readonly reason: string;
}

export type LedgerCommand = GrantBonus | Deduct | ReverseGift | ResetAllRedeemable;

export type AdjustmentKind = "bonus" | "deduction" | "reversal" | "reset";

export type LedgerEvent = {
  readonly type: "adjustment.made";
  readonly kind: AdjustmentKind;
  readonly memberIds: readonly MemberId[];
  readonly amount: number;
  readonly reason: string;
}; // S40
