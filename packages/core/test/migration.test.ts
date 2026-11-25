// HeyTaco migration mapping (S101-S105, S76a, G6, G9). Synthetic rows only, no real data.
import { describe, expect, test } from "vitest";
import {
  decideImportBonus,
  decideImportGift,
  decideImportRedemption,
  planImport,
  reconcileImport,
  redemptionState,
  sha256Hex,
  zonedLocalToInstant,
  type HeyTacoExport,
  type ImportCommand,
  type ImportHeyTacoGift,
  type ImportHeyTacoRedemption,
} from "../src/migration/index.ts";
import { defaultSettings, replay, type Instant, type MemberId, type WorkspaceId } from "../src/index.ts";

const WS = "ws-ht" as WorkspaceId;
const system = { kind: "system", job: "import:heytaco" } as const;

const activity = (over: Partial<HeyTacoExport["activity"][number]["rows"][number]> = {}) => ({
  receiverEmail: "ana@example.test",
  giverEmail: "bob@example.test",
  timestamp: "2026-01-10 09:30:00",
  channel: "tacos",
  message: "thanks <@U2> :taco:",
  tacos: 2,
  tags: "",
  type: "message",
  ...over,
});

const users: HeyTacoExport["users"] = [
  { uid: "U1", email: "Ana@Example.test", dailyLimit: 5, given: 1, received: 2, bonuses: 3, redeemable: 2 },
  { uid: "U2", email: "bob@example.test", dailyLimit: 8, given: 3, received: 1, bonuses: 0, redeemable: 1 },
];

function exportOf(over: Partial<HeyTacoExport> = {}): HeyTacoExport {
  return {
    users,
    activity: [
      {
        file: "taco-data(a).csv",
        rows: [
          activity(),
          activity({ receiverEmail: "bob@example.test", giverEmail: "ana@example.test", tacos: 1, type: "reaction" }),
          activity({ receiverEmail: "gone@example.test", giverEmail: "bob@example.test", tacos: 1, type: "sticker", timestamp: "2026-01-11 10:00:00" }),
        ],
      },
    ],
    redemptions: [
      {
        file: "redemption-data(a).xlsx",
        rows: [
          { uid: "U1", email: "ana@example.test", timestamp: "2026-01-12 12:00:00", title: "Lunch", amount: 3, fulfilled: true },
          { uid: "U9", email: "gone@example.test", timestamp: "2026-01-13 12:00:00", title: "Coffee", amount: 1, fulfilled: false },
        ],
      },
    ],
    ...over,
  };
}

const opts = { workspaceId: WS, settings: defaultSettings({ timezone: "America/Bogota" }), until: null, known: [] };

const gifts = (cmds: readonly ImportCommand[]) => cmds.filter((c): c is ImportHeyTacoGift => c.type === "ImportHeyTacoGift");
const redemptions = (cmds: readonly ImportCommand[]) => cmds.filter((c): c is ImportHeyTacoRedemption => c.type === "ImportHeyTacoRedemption");

describe("S101 HeyTaco rows map to import commands", () => {
  test("S101: one gift command per activity row, one redemption command per redemption row, one bonus per non-zero user total", () => {
    const plan = planImport(exportOf(), opts);
    expect(gifts(plan.commands)).toHaveLength(3);
    expect(redemptions(plan.commands)).toHaveLength(2);
    expect(plan.commands.filter((c) => c.type === "ImportHeyTacoBonus")).toHaveLength(1);
    expect(plan.stats).toMatchObject({ activityRows: 3, activityInWindow: 3, redemptionRows: 2, redemptionInWindow: 2, bonusRows: 1 });
    expect(plan.stats.activityByType).toEqual({ message: 1, reaction: 1, sticker: 1 });
  });

  test("S101: timestamps are read in America/Bogota (UTC-5)", () => {
    expect(zonedLocalToInstant("2026-01-10 09:30:00", "America/Bogota")).toBe(Date.UTC(2026, 0, 10, 14, 30, 0));
    expect(zonedLocalToInstant("2026-07-01 00:00:00", "America/New_York")).toBe(Date.UTC(2026, 6, 1, 4, 0, 0));
    expect(() => zonedLocalToInstant("10/01/2026", "America/Bogota")).toThrow(/timestamp/);
    const [first] = gifts(planImport(exportOf(), opts).commands);
    expect(first?.at).toBe(Date.UTC(2026, 0, 10, 14, 30, 0));
  });

  test("S101: an unknown activity type is refused with a clear error", () => {
    const bad = exportOf({ activity: [{ file: "x.csv", rows: [activity({ type: "boost" })] }] });
    expect(() => planImport(bad, opts)).toThrow(/unknown activity type "boost"/);
  });
});

describe("S102 member matching", () => {
  test("S102: current users are matched by Slack user id and their activity by email (case-insensitive)", () => {
    const plan = planImport(exportOf(), opts);
    const ana = plan.members.find((p) => p.slackUserId === "U1");
    const bob = plan.members.find((p) => p.slackUserId === "U2");
    expect(ana).toMatchObject({ email: "ana@example.test", active: true, isNew: true });
    const [g1, g2] = gifts(plan.commands);
    expect(g1?.receiver).toBe(ana?.id);
    expect(g1?.giver).toBe(bob?.id);
    expect(g2?.receiver).toBe(bob?.id);
  });

  test("S102: a daily limit different from the workspace default becomes a per-member override", () => {
    const plan = planImport(exportOf(), opts);
    expect(plan.members.find((p) => p.slackUserId === "U1")?.dailyLimitOverride).toBeNull();
    expect(plan.members.find((p) => p.slackUserId === "U2")?.dailyLimitOverride).toBe(8);
  });

  test("S102: a departed person is imported once, as a deactivated member, matched by email across activity and redemptions", () => {
    const plan = planImport(exportOf(), opts);
    const gone = plan.members.filter((p) => p.email === "gone@example.test");
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ active: false, slackUserId: "U9", isNew: true });
    expect(gifts(plan.commands)[2]?.receiver).toBe(gone[0]?.id);
    expect(redemptions(plan.commands)[1]?.memberId).toBe(gone[0]?.id);
    expect(plan.stats).toMatchObject({ historicalMembers: 1, redemptionsMatchedByEmailOnly: 1 });
  });

  test("S102: every redemption row of a person who left counts as matched by email, not only the first", () => {
    const gone = { uid: "U9", email: "gone@example.test", title: "Coffee", amount: 1, fulfilled: false } as const;
    const plan = planImport(
      exportOf({ redemptions: [{ file: "r.xlsx", rows: [{ ...gone, timestamp: "2026-01-13 12:00:00" }, { ...gone, timestamp: "2026-01-14 12:00:00" }] }] }),
      opts,
    );
    expect(plan.stats.redemptionsMatchedByEmailOnly).toBe(2);
    expect(new Set(redemptions(plan.commands).map((r) => r.memberId)).size).toBe(1);
  });

  test("S102: existing members are matched by Slack user id first, else by email, and are not created again", () => {
    const known = [
      { memberId: "live-ana" as MemberId, slackUserId: "U1", email: "other@example.test" },
      { memberId: "live-bob" as MemberId, slackUserId: null, email: "BOB@example.test" },
    ];
    const plan = planImport(exportOf(), { ...opts, known });
    expect(plan.members.map((p) => p.email)).toEqual(["gone@example.test"]);
    expect(plan.stats.matchedExisting).toBe(2);
    const [g1] = gifts(plan.commands);
    expect(g1?.receiver).toBe("live-ana");
    expect(g1?.giver).toBe("live-bob");
  });

  test("S102: a historical person with no email falls back to the exported name, else to one unknown member", () => {
    const rows = [
      activity({ giverEmail: "", giverName: "Old Guest" }),
      activity({ giverEmail: "", giverName: "old guest", timestamp: "2026-01-10 09:31:00" }),
      activity({ giverEmail: "", giverName: "", timestamp: "2026-01-10 09:32:00" }),
    ];
    const plan = planImport(exportOf({ activity: [{ file: "x.csv", rows }], redemptions: [] }), opts);
    const [a, b, c] = gifts(plan.commands);
    expect(a?.giver).toBe(b?.giver);
    expect(c?.giver).not.toBe(a?.giver);
    const noEmail = plan.members.filter((p) => p.email === null);
    expect(noEmail).toHaveLength(2);
    expect(noEmail.every((p) => !p.active)).toBe(true);
    expect(plan.stats.membersWithoutEmail).toBe(2);
  });

  test("S102: member ids are deterministic UUID-shaped strings", () => {
    const a = planImport(exportOf(), opts).members.map((p) => p.id);
    const b = planImport(exportOf(), opts).members.map((p) => p.id);
    expect(a).toEqual(b);
    for (const id of a) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("S104 redemption fulfilled flag", () => {
  test("S104: 1 maps to fulfilled and 0 to approved", () => {
    for (const f of [true, 1, "1", "TRUE"]) expect(redemptionState(f)).toBe("fulfilled");
    for (const f of [false, 0, "0", "false"]) expect(redemptionState(f)).toBe("approved");
    expect(() => redemptionState("maybe")).toThrow(/fulfilled flag/);
  });

  test("S104: imported redemptions carry their state and count per state", () => {
    const plan = planImport(exportOf(), opts);
    expect(redemptions(plan.commands).map((r) => r.state)).toEqual(["fulfilled", "approved"]);
    expect(plan.stats).toMatchObject({ redemptionsFulfilled: 1, redemptionsApproved: 1 });
  });

  test("S104: the redemption decider spends without the S35 guard and returns the state", () => {
    const [cmd] = redemptions(planImport(exportOf(), opts).commands);
    if (!cmd) throw new Error("missing command");
    const d = decideImportRedemption({}, cmd, 0 as Instant);
    expect(d.outcome).toEqual({ ok: true, value: { redemptionId: cmd.redemptionId, state: "fulfilled" } });
    expect(d.entries).toEqual([
      { kind: "spend", amount: 3, memberId: cmd.memberId, counterpartId: null, cause: { type: "redemption", redemptionId: cmd.redemptionId }, source: null, allowanceDay: null, reason: "Lunch" },
    ]);
    expect(d.events).toEqual([]);
  });
});

describe("S105 deterministic import keys", () => {
  test("S105: keys are namespaced, content-hashed and stable across runs", () => {
    const a = planImport(exportOf(), opts).commands.map((c) => c.key);
    const b = planImport(exportOf(), opts).commands.map((c) => c.key);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect(a[0]).toMatch(/^import:heytaco:gift:[0-9a-f]{32}:1$/);
    expect(a.find((k) => k.includes(":redemption:"))).toMatch(/^import:heytaco:redemption:[0-9a-f]{32}:1$/);
    expect(a.find((k) => k.includes(":bonus:"))).toMatch(/^import:heytaco:bonus:[0-9a-f]{32}$/);
  });

  test("S105: genuinely repeated rows keep their multiplicity through an occurrence index", () => {
    const twice = exportOf({ activity: [{ file: "x.csv", rows: [activity(), activity()] }] });
    const plan = planImport(twice, opts);
    expect(gifts(plan.commands).map((c) => c.key.slice(-2))).toEqual([":1", ":2"]);
    expect(plan.stats.duplicateRowsKept).toBe(1);
  });

  test("S105: sha256 matches the standard test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("señor 🌮")).toBe("9a0bafcdea9fee69dfff5c94a266dfee620c6a6a7a3fdc74c9c01af576fb2e26");
    expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });
});

describe("S76a stickers and imported gifts", () => {
  test("S76a: sticker rows are imported as gifts with source sticker", () => {
    const sticker = gifts(planImport(exportOf(), opts).commands).find((c) => c.source === "sticker");
    expect(sticker).toBeDefined();
  });

  test("S76a: imported gifts carry no allowance day and emit no notifications", () => {
    for (const cmd of gifts(planImport(exportOf(), opts).commands)) {
      const d = decideImportGift({ storeMessageText: true }, cmd, 0 as Instant);
      expect(d.outcome.ok).toBe(true);
      expect(d.events).toEqual([]);
      expect(d.entries).toHaveLength(1);
      expect(d.entries[0]).toMatchObject({ kind: "gift", amount: cmd.amount, memberId: cmd.receiver, counterpartId: cmd.giver, source: cmd.source, allowanceDay: null, cause: { type: "gift", giftId: cmd.giftId } });
      expect(d.writes).toEqual([
        { t: "gift.upsert", gift: { id: cmd.giftId, giver: cmd.giver, messageRef: null, source: cmd.source, emoji: null, channelId: cmd.channel, isPrivate: false, text: cmd.text, valueIds: [], allowanceDay: null, createdAt: cmd.at, closedBy: null } },
      ]);
    }
  });

  test("S76a: with message text storage off, the imported gift header keeps no text", () => {
    const [cmd] = gifts(planImport(exportOf(), opts).commands);
    if (!cmd) throw new Error("missing command");
    const d = decideImportGift({ storeMessageText: false }, cmd, 0 as Instant);
    expect(d.writes[0]?.gift.text).toBeNull();
  });

  test("S76a: a non-positive or fractional amount is rejected, so G9 completeness catches it", () => {
    const [cmd] = gifts(planImport(exportOf({ activity: [{ file: "x.csv", rows: [activity({ tacos: 0 })] }] }), opts).commands);
    if (!cmd) throw new Error("missing command");
    expect(decideImportGift({ storeMessageText: true }, cmd, 0 as Instant).outcome).toEqual({ ok: false, error: { code: "invalid_amount" } });
  });

  test("S76a: only admins or system jobs may import", () => {
    const [cmd] = gifts(planImport(exportOf(), opts).commands);
    if (!cmd) throw new Error("missing command");
    const asMember = { ...cmd, actor: { kind: "member", memberId: "x" as MemberId, role: "member" } } as const;
    expect(decideImportGift({ storeMessageText: true }, asMember, 0 as Instant).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    const bonus = planImport(exportOf(), opts).commands.find((c) => c.type === "ImportHeyTacoBonus");
    if (bonus?.type !== "ImportHeyTacoBonus") throw new Error("missing bonus");
    expect(bonus.actor).toEqual(system);
    expect(decideImportBonus({}, bonus, 0 as Instant).entries).toEqual([
      { kind: "bonus", amount: 3, memberId: bonus.memberId, counterpartId: null, cause: { type: "import", source: "heytaco" }, source: null, allowanceDay: null, reason: "HeyTaco bonus total" },
    ]);
  });
});

describe("G6 importer cutoff", () => {
  test("S105 G6: --until keeps only rows strictly before the cutoff and counts the rest as skipped", () => {
    const until = zonedLocalToInstant("2026-01-11 10:00:00", "America/Bogota");
    const plan = planImport(exportOf(), { ...opts, until });
    expect(gifts(plan.commands)).toHaveLength(2);
    expect(redemptions(plan.commands)).toHaveLength(0);
    expect(plan.stats).toMatchObject({ activityRows: 3, activityInWindow: 2, redemptionRows: 2, redemptionInWindow: 0 });
  });
});

describe("S103 G9 reconciliation", () => {
  const plan = planImport(exportOf(), opts);
  const decided = plan.commands.flatMap((c) =>
    c.type === "ImportHeyTacoGift" ? decideImportGift({ storeMessageText: true }, c, 0 as Instant).entries : c.type === "ImportHeyTacoRedemption" ? decideImportRedemption({}, c, 0 as Instant).entries : decideImportBonus({}, c, 0 as Instant).entries,
  );
  const balances = replay(decided);
  const counts = { activityImported: 3, redemptionsImported: 2, secondImportAdded: 0 };

  test("S103: 0 diffs on received, given and redeemable for current users gives ok", () => {
    const r = reconcileImport(plan, balances, counts);
    expect(r).toMatchObject({ ok: true, currentUsers: 2, membersWithDiff: { received: 0, given: 0, redeemable: 0, any: 0 }, givenByCurrentMembers: 4 });
  });

  test("S103: any balance diff fails the reconciliation", () => {
    const off = new Map(balances);
    const ana = plan.expected[0];
    if (!ana) throw new Error("missing user");
    off.set(ana.memberId, { received: 99, given: 1, redeemable: 2 });
    expect(reconcileImport(plan, off, counts)).toMatchObject({ ok: false, membersWithDiff: { received: 1, given: 0, redeemable: 0, any: 1 } });
  });

  test("S103 G9: a lost activity row or redemption fails even when user totals match", () => {
    expect(reconcileImport(plan, balances, { ...counts, activityImported: 2 }).ok).toBe(false);
    expect(reconcileImport(plan, balances, { ...counts, redemptionsImported: 1 }).ok).toBe(false);
  });

  test("S105: a second import that adds entries fails the reconciliation", () => {
    expect(reconcileImport(plan, balances, { ...counts, secondImportAdded: 1 }).ok).toBe(false);
  });
});

describe("S104 imported redemptions are shop redemptions", () => {
  const cmd = (over: Partial<ImportHeyTacoRedemption> = {}): ImportHeyTacoRedemption => ({
    type: "ImportHeyTacoRedemption",
    key: "import:heytaco:redemption:1" as never,
    workspaceId: WS,
    actor: system,
    at: Date.UTC(2025, 2, 3, 14, 0, 0) as Instant,
    redemptionId: "rd-1",
    memberId: "ana" as MemberId,
    amount: 40,
    title: "Gift card",
    state: "approved",
    ...over,
  });

  test("S104: the decision spends the amount and writes the redemption record in HeyTaco's state, at HeyTaco's time", () => {
    for (const state of ["approved", "fulfilled"] as const) {
      const d = decideImportRedemption({}, cmd({ state }), 0 as Instant);
      expect(d.outcome).toEqual({ ok: true, value: { redemptionId: "rd-1", state } });
      expect(d.entries).toEqual([
        { kind: "spend", amount: 40, memberId: "ana", counterpartId: null, cause: { type: "redemption", redemptionId: "rd-1" }, source: null, allowanceDay: null, reason: "Gift card" },
      ]);
      expect(d.writes).toEqual([
        {
          t: "shop.redemption.put",
          from: null,
          redemption: {
            id: "rd-1",
            memberId: "ana",
            rewardId: null,
            variantId: null,
            collabId: null,
            cost: 40,
            internalCost: null,
            budgetMonth: null,
            stockReserved: false,
            giftCard: false,
            cardIssued: false,
            onBehalfOf: "self",
            state,
            createdAt: Date.UTC(2025, 2, 3, 14, 0, 0),
            updatedAt: Date.UTC(2025, 2, 3, 14, 0, 0),
            reason: "Gift card",
          },
        },
      ]);
      expect(d.events).toEqual([]);
    }
  });

  test("S104: a non-positive or oversized amount and a non-admin actor are refused and write nothing", () => {
    expect(decideImportRedemption({}, cmd({ amount: 0 }), 0 as Instant)).toEqual({ outcome: { ok: false, error: { code: "invalid_amount" } }, entries: [], writes: [], events: [] });
    expect(decideImportRedemption({}, cmd({ amount: 1_000_001 }), 0 as Instant).outcome).toEqual({ ok: false, error: { code: "amount_too_large", max: 1_000_000 } });
    expect(decideImportRedemption({}, cmd({ actor: { kind: "member", memberId: "ana" as MemberId, role: "member" } }), 0 as Instant).outcome).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
  });
});

test("S101: the migration module is exported from @propi/core's entrypoint", async () => {
  const core = await import("../src/index.ts");
  const migration = await import("../src/migration/index.ts");
  expect(core.planImport).toBe(migration.planImport);
  expect(core.decideImportRedemption).toBe(migration.decideImportRedemption);
  expect(core.reconcileImport).toBe(migration.reconcileImport);
  expect(core.HEYTACO_EXPORT_TIMEZONE).toBe("America/Bogota");
});
