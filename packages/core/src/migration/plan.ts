// S101-S105, S76a, G6: pure mapping from parsed HeyTaco rows to members and import commands.
import type { CommandKey, GiftId, Instant, MemberId, PosInt, WorkspaceId } from "../shared/types.ts";
import { isPosInt } from "../shared/types.ts";
import type { GiftSource } from "../ledger/entries.ts";
import type { WorkspaceSettings } from "../workspace/settings.ts";
import { sha256Hex, uuidFromHash } from "./sha256.ts";
import {
  IMPORT_ACTOR,
  type ExpectedTotals,
  type HeyTacoExport,
  type ImportCommand,
  type ImportPlan,
  type KnownIdentity,
  type PlannedMember,
  type RedemptionState,
} from "./types.ts";
import { zonedLocalToInstant } from "./zoned.ts";

/** HeyTaco exports every timestamp in this zone ("Timestamp (America/Bogota)"). */
export const HEYTACO_EXPORT_TIMEZONE = "America/Bogota";

export interface PlanOptions {
  readonly workspaceId: WorkspaceId;
  readonly settings: WorkspaceSettings;
  /** G6: import only rows strictly before this instant; null imports everything. */
  readonly until: Instant | null;
  /** Members already in the workspace (S102). */
  readonly known: readonly KnownIdentity[];
}

const hash32 = (s: string) => sha256Hex(s).slice(0, 32);
const normEmail = (e: string) => e.trim().toLowerCase();
const SOURCES: readonly GiftSource[] = ["message", "reaction", "sticker"];

/** S104: HeyTaco's Fulfilled flag. 1 -> fulfilled, 0 -> approved (awaiting fulfilment). */
export function redemptionState(flag: boolean | number | string): RedemptionState {
  const v = typeof flag === "string" ? flag.trim().toLowerCase() : flag;
  if (v === true || v === 1 || v === "1" || v === "true") return "fulfilled";
  if (v === false || v === 0 || v === "0" || v === "false") return "approved";
  throw new Error(`unknown fulfilled flag ${JSON.stringify(flag)}: expected 1 or 0`);
}

type Draft = { -readonly [K in keyof PlannedMember]: PlannedMember[K] };

export function planImport(data: HeyTacoExport, opts: PlanOptions): ImportPlan {
  const byUid = new Map<string, MemberId>();
  const byEmail = new Map<string, MemberId>();
  for (const k of opts.known) {
    if (k.slackUserId) byUid.set(k.slackUserId, k.memberId);
    if (k.email) byEmail.set(normEmail(k.email), k.memberId);
  }
  const drafts = new Map<MemberId, Draft>();
  let matchedExisting = 0;

  const remember = (id: MemberId, uid: string | null, email: string | null) => {
    if (uid && !byUid.has(uid)) byUid.set(uid, id);
    if (email && !byEmail.has(email)) byEmail.set(email, id);
    const d = drafts.get(id);
    if (d && uid && d.slackUserId === null) d.slackUserId = uid;
  };

  const create = (seed: string, uid: string | null, email: string | null, active: boolean, override: PosInt | null): MemberId => {
    const id = uuidFromHash(sha256Hex(`heytaco:member:${seed}`)) as MemberId;
    drafts.set(id, { id, slackUserId: uid, email, active, dailyLimitOverride: override, isNew: true });
    remember(id, uid, email);
    return id;
  };

  // 1. Current users: Slack user id first, else email (S102). Their totals are the S103 target.
  const expected: ExpectedTotals[] = [];
  for (const u of data.users) {
    const email = normEmail(u.email) || null;
    let id = byUid.get(u.uid) ?? (email ? byEmail.get(email) : undefined);
    if (id !== undefined) {
      matchedExisting++;
      remember(id, u.uid, email);
    } else {
      const override = u.dailyLimit !== opts.settings.defaultDailyAllowance && isPosInt(u.dailyLimit) ? u.dailyLimit : null;
      id = create(`uid:${u.uid}`, u.uid, email, true, override);
    }
    expected.push({ memberId: id, received: u.received, given: u.given, redeemable: u.redeemable });
  }

  // Historical people (not in users.xlsx) become deactivated members keyed by email (S102).
  const historical = (email: string, uid: string | null): MemberId => {
    if (email === "" && uid === null) throw new Error("a HeyTaco row has neither an email nor a Slack user id");
    return create(email !== "" ? `email:${email}` : `uid:${uid}`, uid, email || null, false, null);
  };
  // Activity rows carry only emails. A person exported without one is matched by display name,
  // else they all fold into one unknown member, so HeyTaco's counts still hold (S102, S103).
  const activityIdentity = (rawEmail: string, rawName: string | undefined): { id: MemberId; key: string } => {
    const email = normEmail(rawEmail);
    if (email !== "") return { id: byEmail.get(email) ?? historical(email, null), key: email };
    const name = (rawName ?? "").trim().toLowerCase();
    const seed = name === "" ? "unknown" : `name:${name}`;
    const id = uuidFromHash(sha256Hex(`heytaco:member:${seed}`)) as MemberId;
    if (!drafts.has(id) && !opts.known.some((k) => k.memberId === id)) drafts.set(id, { id, slackUserId: null, email: null, active: false, dailyLimitOverride: null, isNew: true });
    return { id, key: seed };
  };

  const commands: ImportCommand[] = [];
  const inWindow = (at: Instant) => opts.until === null || at < opts.until;
  const base = (key: string, at: Instant) => ({ key: key as CommandKey, workspaceId: opts.workspaceId, actor: IMPORT_ACTOR, at });

  // 2. Activity: one gift per row, stickers included (S76a). Occurrence index keeps repeated rows (S105).
  const activityByType: Record<GiftSource, number> = { message: 0, reaction: 0, sticker: 0 };
  let activityRows = 0;
  let activityInWindow = 0;
  let duplicateRowsKept = 0;
  for (const file of data.activity) {
    const seen = new Map<string, number>();
    for (const r of file.rows) {
      activityRows++;
      const source = r.type.trim().toLowerCase() as GiftSource;
      if (!SOURCES.includes(source)) throw new Error(`unknown activity type "${r.type}" in ${file.file}`);
      const receiver = activityIdentity(r.receiverEmail, r.receiverName);
      const giver = activityIdentity(r.giverEmail, r.giverName);
      const content = [receiver.key, giver.key, r.timestamp, r.channel, r.message, String(r.tacos), source].join("\u0001");
      const h = hash32(content);
      const n = (seen.get(h) ?? 0) + 1;
      seen.set(h, n);
      if (n > 1) duplicateRowsKept++;
      const at = zonedLocalToInstant(r.timestamp, HEYTACO_EXPORT_TIMEZONE);
      if (!inWindow(at)) continue;
      activityInWindow++;
      activityByType[source]++;
      const key = `import:heytaco:gift:${h}:${n}`;
      commands.push({
        ...base(key, at),
        type: "ImportHeyTacoGift",
        giftId: uuidFromHash(sha256Hex(key)) as GiftId,
        receiver: receiver.id,
        giver: giver.id,
        amount: r.tacos,
        source,
        channel: r.channel,
        text: r.message,
        tags: r.tags,
      });
    }
  }

  // 3. Redemptions: Slack user id, else the row's email (people who left), S102. State per S104.
  // Slack ids of current users and known members; a redemption by anyone else belongs to someone who left.
  const currentUids = new Set(byUid.keys());
  let redemptionRows = 0;
  let redemptionInWindow = 0;
  let matchedByEmailOnly = 0;
  let fulfilled = 0;
  let approved = 0;
  for (const file of data.redemptions) {
    const seen = new Map<string, number>();
    for (const r of file.rows) {
      redemptionRows++;
      const uid = r.uid.trim() || null;
      const email = normEmail(r.email);
      if (uid === null || !currentUids.has(uid)) matchedByEmailOnly++;
      let memberId = uid ? byUid.get(uid) : undefined;
      if (memberId === undefined) {
        memberId = (email ? byEmail.get(email) : undefined) ?? historical(email, uid);
        remember(memberId, uid, email || null);
      }
      const state = redemptionState(r.fulfilled);
      const content = [uid ?? "", email, r.timestamp, r.title, String(r.amount)].join("\u0001");
      const h = hash32(content);
      const n = (seen.get(h) ?? 0) + 1;
      seen.set(h, n);
      const at = zonedLocalToInstant(r.timestamp, HEYTACO_EXPORT_TIMEZONE);
      if (!inWindow(at)) continue;
      redemptionInWindow++;
      if (state === "fulfilled") fulfilled++;
      else approved++;
      const key = `import:heytaco:redemption:${h}:${n}`;
      commands.push({ ...base(key, at), type: "ImportHeyTacoRedemption", redemptionId: uuidFromHash(sha256Hex(key)), memberId, amount: r.amount, title: r.title, state });
    }
  }

  // 4. Bonuses: HeyTaco exports only a per-user total, so one bonus per user with a non-zero total.
  let bonusRows = 0;
  for (const u of data.users) {
    if (u.bonuses === 0) continue;
    const memberId = byUid.get(u.uid);
    if (memberId === undefined) throw new Error("internal: user without a member");
    bonusRows++;
    commands.push({ ...base(`import:heytaco:bonus:${hash32(`uid:${u.uid}`)}`, 0 as Instant), type: "ImportHeyTacoBonus", memberId, amount: u.bonuses });
  }

  const members = [...drafts.values()].map((d): PlannedMember => ({ ...d }));
  return {
    members,
    commands,
    expected,
    stats: {
      activityRows,
      activityInWindow,
      activityByType,
      duplicateRowsKept,
      redemptionRows,
      redemptionInWindow,
      redemptionsMatchedByEmailOnly: matchedByEmailOnly,
      redemptionsFulfilled: fulfilled,
      redemptionsApproved: approved,
      bonusRows,
      currentUsers: data.users.length,
      historicalMembers: members.filter((p) => !p.active).length,
      membersWithoutEmail: members.filter((p) => p.email === null).length,
      matchedExisting,
    },
  };
}
