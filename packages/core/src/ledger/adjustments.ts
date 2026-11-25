// S35-S40: admin adjustments as pure deciders.
import { accept, reject, type Decision } from "../shared/decision.ts";
import type { Actor, CommandKey, GiftId, Instant, MemberId, Outcome, PosInt } from "../shared/types.ts";
import { MAX_ENTRY_AMOUNT, entryAmounts, isEntryAmount, isPosInt } from "../shared/types.ts";
import { canAdjust } from "../members/members.ts";
import type { Gift } from "../giving/types.ts";
import type { NewEntry } from "./entries.ts";
import type { AdjustmentKind, Deduct, GrantBonus, ResetAllRedeemable, ReverseGift } from "./commands.ts";

const adminEntry = (kind: "bonus" | "deduction", memberId: MemberId, amount: PosInt, reason: string): NewEntry => ({
  kind,
  amount,
  memberId,
  counterpartId: null,
  cause: { type: "admin" },
  source: null,
  allowanceDay: null,
  reason,
});

function guard<T>(actor: Actor, reason: string, amount: number | null): Decision<T> | null {
  if (!canAdjust(actor)) return reject({ code: "forbidden", need: "admin" });
  if (reason.trim() === "") return reject({ code: "reason_required" });
  if (amount !== null && !isPosInt(amount)) return reject({ code: "invalid_amount" });
  if (amount !== null && !isEntryAmount(amount)) return reject({ code: "amount_too_large", max: MAX_ENTRY_AMOUNT });
  return null;
}

export interface KnownMembersSnapshot {
  readonly knownMembers: ReadonlySet<MemberId>;
}

/** S36: a bonus moves redeemable only. */
export function decideGrantBonus(s: KnownMembersSnapshot, cmd: GrantBonus, _now: Instant): Decision<{ memberIds: MemberId[]; amount: number }> {
  const denied = guard<{ memberIds: MemberId[]; amount: number }>(cmd.actor, cmd.reason, cmd.amount);
  if (denied) return denied;
  const memberIds = [...new Set(cmd.memberIds)];
  if (memberIds.length === 0) return reject({ code: "invalid_amount" });
  const unknown = memberIds.find((m) => !s.knownMembers.has(m));
  if (unknown !== undefined) return reject({ code: "unknown_member", memberId: unknown });
  return accept(
    { memberIds, amount: cmd.amount },
    {
      entries: memberIds.map((m) => adminEntry("bonus", m, cmd.amount, cmd.reason)),
      events: [{ type: "adjustment.made", kind: "bonus", memberIds, amount: cmd.amount, reason: cmd.reason }],
    },
  );
}

/** S37: a deduction needs a reason. S35: it is not guarded and may drive redeemable negative. */
export function decideDeduct(s: KnownMembersSnapshot, cmd: Deduct, _now: Instant): Decision<{ memberId: MemberId; amount: number }> {
  const denied = guard<{ memberId: MemberId; amount: number }>(cmd.actor, cmd.reason, cmd.amount);
  if (denied) return denied;
  if (!s.knownMembers.has(cmd.memberId)) return reject({ code: "unknown_member", memberId: cmd.memberId });
  return accept(
    { memberId: cmd.memberId, amount: cmd.amount },
    {
      entries: [adminEntry("deduction", cmd.memberId, cmd.amount, cmd.reason)],
      events: [{ type: "adjustment.made", kind: "deduction", memberIds: [cmd.memberId], amount: cmd.amount, reason: cmd.reason }],
    },
  );
}

export interface ReverseGiftSnapshot {
  readonly gift: Gift | null;
  readonly net: ReadonlyMap<MemberId, number>;
}

/**
 * S38: undo what each receiver still holds; allowance is not restored (allowanceDay null).
 * The reversal is final: the gift is closed so a later edit cannot re-gift it (S23).
 */
export function decideReverseGift(s: ReverseGiftSnapshot, cmd: ReverseGift, _now: Instant): Decision<{ giftId: GiftId; reversed: number }> {
  const denied = guard<{ giftId: GiftId; reversed: number }>(cmd.actor, cmd.reason, null);
  if (denied) return denied;
  const gift = s.gift;
  if (gift === null) return reject({ code: "gift_not_found" });
  const entries: NewEntry[] = [];
  for (const [memberId, net] of s.net) {
    if (!isPosInt(net)) continue;
    entries.push({ kind: "gift_reversal", amount: net, memberId, counterpartId: gift.giver, cause: { type: "gift", giftId: gift.id }, source: gift.source, allowanceDay: null, reason: cmd.reason });
  }
  const reversed = entries.reduce((t, e) => t + e.amount, 0);
  return accept(
    { giftId: gift.id, reversed },
    {
      entries,
      writes: [{ t: "gift.upsert", gift: { ...gift, closedBy: "admin" } }],
      events:
        reversed === 0
          ? []
          : [
              { type: "gift.reversed", giftId: gift.id, amount: reversed as PosInt, why: "admin" },
              { type: "adjustment.made", kind: "reversal", memberIds: entries.map((e) => e.memberId), amount: reversed, reason: cmd.reason },
            ],
    },
  );
}

export interface ResetSnapshot {
  readonly redeemable: ReadonlyMap<MemberId, number>;
}

/**
 * S39: one deduction of exactly the positive redeemable per member; received and history untouched.
 * A redeemable above MAX_ENTRY_AMOUNT is deducted in several capped entries that sum to it.
 */
export function decideResetAll(s: ResetSnapshot, cmd: ResetAllRedeemable, _now: Instant): Decision<{ members: number; total: number }> {
  const denied = guard<{ members: number; total: number }>(cmd.actor, cmd.reason, null);
  if (denied) return denied;
  const entries: NewEntry[] = [];
  for (const [memberId, redeemable] of [...s.redeemable].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (isPosInt(redeemable)) for (const amount of entryAmounts(redeemable)) entries.push(adminEntry("deduction", memberId, amount, cmd.reason));
  }
  const total = entries.reduce((t, e) => t + e.amount, 0);
  const memberIds = [...new Set(entries.map((e) => e.memberId))];
  return accept(
    { members: memberIds.length, total },
    { entries, events: [{ type: "adjustment.made", kind: "reset", memberIds, amount: total, reason: cmd.reason }] },
  );
}

// ───────────── S40 audit ─────────────

const AUDITED: Readonly<Record<string, AdjustmentKind>> = {
  GrantBonus: "bonus",
  Deduct: "deduction",
  ReverseGift: "reversal",
  ResetAllRedeemable: "reset",
};

export interface CommandLogView {
  readonly key: CommandKey;
  readonly commandType: string;
  readonly actor: Actor;
  readonly at: Instant;
  readonly command: unknown;
  readonly result: Outcome<unknown>;
}

export interface AuditRecord {
  readonly key: CommandKey;
  readonly action: AdjustmentKind;
  readonly actor: Actor;
  readonly at: Instant;
  readonly reason: string;
  readonly ok: boolean;
}

/** S40: an admin adjustment as an audit row (actor, time, reason). Null for other commands. */
export function auditRecord(log: CommandLogView): AuditRecord | null {
  const action = AUDITED[log.commandType];
  if (action === undefined) return null;
  const reason = (log.command as { reason?: unknown }).reason;
  return { key: log.key, action, actor: log.actor, at: log.at, reason: typeof reason === "string" ? reason : "", ok: log.result.ok };
}
