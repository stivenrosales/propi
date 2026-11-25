// Seeds a demo workspace with synthetic people and history, for local development and screenshots.
// Every write goes through createApp().execute with the Postgres adapter (S106); only workspace setup,
// members and values (which have no domain command yet) use the db admin port.
// Never reads data/. Re-running is safe: a workspace that was already seeded is left as it is.
//
//   DATABASE_URL=postgresql://propi:propi@localhost:55433/propi node apps/web/scripts/seed-demo.mts
import {
  createApp,
  defaultSettings,
  engagementHandlers,
  type Actor,
  type CommandKey,
  type Instant,
  type MemberId,
  type PosInt,
  type ValueId,
  type WorkspaceId,
} from "@propi/app";
import { createDbAdmin, createDbEngagementStores, createDbInsights, createDbPorts, createPrismaClient, uuidv7 } from "@propi/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("seed-demo needs DATABASE_URL");
  process.exit(1);
}

const WS = (process.env.PROPI_DEMO_WORKSPACE ?? "demo") as WorkspaceId;
const DAY = 86_400_000;
const NOW = Date.now();

const prisma = createPrismaClient(url, { maxConnections: 4 });
let clock = NOW;
let n = 0;
const ports = createDbPorts(prisma, { clock: { now: () => clock as Instant }, ids: { next: () => uuidv7(clock + n++) } });
const app = createApp(ports, { handlers: engagementHandlers({ reader: ports.reader, directory: ports.directory, ...createDbEngagementStores(prisma) }) });
const admin = createDbAdmin(prisma);

const PEOPLE = [
  ["ana-torres", "admin"],
  ["bruno-diaz", "approver"],
  ["carla-mendez", "member"],
  ["diego-ruiz", "member"],
  ["elena-vargas", "member"],
  ["felipe-soto", "member"],
  ["gabriela-rios", "member"],
  ["hugo-paredes", "member"],
  ["isabel-cruz", "member"],
  ["julian-ortega", "member"],
] as const;
const m = (id: string) => id as MemberId;
const actorOf = (id: string, role: "admin" | "approver" | "member" = "member"): Actor => ({ kind: "member", memberId: m(id), role });
const ANA = actorOf("ana-torres", "admin");
const BRUNO = actorOf("bruno-diaz", "approver");

// Deterministic pseudo-random numbers, so every run produces the same history.
let seed = 42;
const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

let failures = 0;
async function run(label: string, cmd: Record<string, unknown> & { type: string; actor: Actor }, at = NOW): Promise<unknown> {
  clock = at;
  const res = await app.executeAny({ key: `seed:${label}` as CommandKey, workspaceId: WS, at: at as Instant, ...cmd });
  if (!res.ok && !["over_allowance"].includes(res.error.code)) {
    failures++;
    console.warn(`  ${label}: ${res.error.code}`);
  }
  return res.ok ? res.value : null;
}

async function main() {
  const already = await prisma.commandLog.count({ where: { workspaceId: WS, key: { startsWith: "seed:" } } });
  if (already > 0) {
    console.log(`Workspace "${WS}" is already seeded (${already} commands). Set PROPI_DEMO_WORKSPACE to seed another one.`);
    await prisma.$disconnect();
    return;
  }
  console.log(`Seeding workspace "${WS}"…`);
  await admin.addWorkspace(
    WS,
    defaultSettings({
      timezone: "America/Lima",
      currency: { primaryEmoji: ":propi:", singular: "prop", plural: "props", extraEmojis: new Map([[":fire:", 3]]) },
      defaultDailyAllowance: 5 as PosInt,
      adminDailyAllowance: 8 as PosInt,
    }),
  );
  for (const [id, role] of PEOPLE) await admin.addMember(WS, { id: m(id), role, active: true, dailyLimitOverride: null });
  await admin.addMember(WS, { id: m("karen-luna"), role: "member", active: false, dailyLimitOverride: null });
  const values = [
    { id: "v-ownership" as ValueId, name: "Ownership", hashtag: "#ownership", emoji: ":muscle:" },
    { id: "v-teamwork" as ValueId, name: "Teamwork", hashtag: "#teamwork", emoji: ":handshake:" },
    { id: "v-craft" as ValueId, name: "Craft", hashtag: "#craft", emoji: ":hammer:" },
    { id: "v-fun" as ValueId, name: "Fun", hashtag: "#fun", emoji: ":tada:" },
  ];
  await admin.setValues(WS, values);
  await createDbInsights(prisma).setSettings(WS, { shopUrl: "http://localhost:3000/app/shop" });

  // 60 days of gifts.
  const reasons = [
    "thanks for pairing on the release",
    "for unblocking the deploy at 7am",
    "great demo today",
    "for the thoughtful code review",
    "you made onboarding painless",
    "for covering my on-call shift",
    "the new dashboard looks amazing",
    "for taking notes for everyone",
  ];
  const ids = PEOPLE.map(([id]) => id);
  let gifts = 0;
  for (let day = 60; day >= 0; day--) {
    const perDay = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < perDay; i++) {
      const giver = pick(ids);
      let receiver = pick(ids);
      if (receiver === giver) receiver = ids[(ids.indexOf(giver) + 1) % ids.length]!;
      const units = 1 + Math.floor(rand() * 3);
      const value = rand() < 0.65 ? pick(values) : null;
      const text = `<@${receiver}> ${pick(reasons)} ${":propi: ".repeat(units).trim()}${value ? ` ${value.hashtag}` : ""}`;
      const at = NOW - day * DAY - Math.floor(rand() * 6 * 3_600_000);
      const ok = await run(
        `gift:${day}:${i}`,
        {
          type: "GiveByMessage",
          actor: actorOf(giver, giver === "ana-torres" ? "admin" : giver === "bruno-diaz" ? "approver" : "member"),
          messageRef: `demo:C-${day}-${i}`,
          message: {
            channel: { id: pick(["C-general", "C-eng", "C-design", "C-sales"]), kind: "public" },
            text,
            mentions: [{ kind: "member", memberId: m(receiver) }],
            emojiTokens: Array.from({ length: units }, () => ":propi:"),
            hashtags: value ? [value.hashtag] : [],
          },
        },
        at,
      );
      if (ok) gifts++;
    }
  }
  console.log(`  ${gifts} gifts`);

  await run("bonus:kickoff", { type: "GrantBonus", actor: ANA, memberIds: ids.map(m), amount: 15, reason: "Welcome to Propi!" }, NOW - 59 * DAY);

  // Shop.
  await run("shop:config", { type: "ConfigureShop", actor: ANA, settings: { autoApprove: false, monthlyBudget: { minor: 50_000, currency: "PEN" } } }, NOW - 58 * DAY);
  const rewards = [
    { title: "Coffee with the CEO", cost: 25, stock: 5, categories: ["Experiences"], internal: 0, description: "A 30 minute coffee chat, on us." },
    { title: "Propi hoodie", cost: 60, stock: 12, categories: ["Swag"], internal: 9_000, description: "Cozy coral hoodie with the token on the back." },
    { title: "Half day off", cost: 120, stock: null, categories: ["Time off"], internal: 0, description: "Take a Friday afternoon. Plan it with your lead." },
    { title: "Book of your choice", cost: 35, stock: null, categories: ["Learning"], internal: 6_000, description: "Any book up to S/ 60, delivered to your desk." },
    { title: "Lunch for two", cost: 45, stock: 8, categories: ["Experiences"], internal: 8_000, description: "Lunch at a place of your choice with a teammate." },
    { title: "Sticker pack", cost: 8, stock: 40, categories: ["Swag"], internal: 1_500, description: "Ten vinyl stickers with the mascot." },
  ];
  const rewardIds: string[] = [];
  for (const [i, r] of rewards.entries()) {
    const created = (await run(
      `reward:${i}`,
      {
        type: "CreateReward",
        actor: ANA,
        reward: {
          title: r.title,
          description: r.description,
          image: null,
          cost: r.cost,
          stock: r.stock,
          variants: [],
          categories: r.categories,
          internalCost: r.internal > 0 ? { minor: r.internal, currency: "PEN" } : null,
          instructions: "We will reach out within two working days.",
          autoApprove: null,
          giftCard: false,
        },
      },
      NOW - 58 * DAY,
    )) as { rewardId: string } | null;
    if (created) {
      rewardIds.push(created.rewardId);
      await run(`reward:${i}:activate`, { type: "SetRewardStatus", actor: ANA, rewardId: created.rewardId, status: "active" }, NOW - 58 * DAY);
    }
  }

  // Redemptions in every state.
  const redeem = async (label: string, who: string, reward: number, ago: number) =>
    ((await run(label, { type: "Redeem", actor: actorOf(who), memberId: m(who), rewardId: rewardIds[reward], variantId: null }, NOW - ago * DAY)) as { redemptionId: string } | null)?.redemptionId;
  const move = (label: string, id: string | undefined, transition: string, ago: number, reason: string | null = null) =>
    id ? run(label, { type: "TransitionRedemption", actor: BRUNO, redemptionId: id, transition, reason }, NOW - ago * DAY) : null;
  const r1 = await redeem("redeem:1", "carla-mendez", 5, 20);
  await move("redeem:1:approve", r1, "approve", 19);
  await move("redeem:1:fulfil", r1, "fulfil", 18);
  const r2 = await redeem("redeem:2", "diego-ruiz", 3, 9);
  await move("redeem:2:approve", r2, "approve", 8);
  const r3 = await redeem("redeem:3", "elena-vargas", 0, 6);
  await move("redeem:3:reject", r3, "reject", 5, "Out of office this month, try again in December");
  await redeem("redeem:4", "felipe-soto", 5, 2);
  await redeem("redeem:5", "gabriela-rios", 3, 1);
  await redeem("redeem:6", "hugo-paredes", 0, 0);
  await redeem("redeem:7", "julian-ortega", 5, 0);

  // A collaborative reward with contributions (S56-S59).
  const collab = (await run("collab:1", { type: "CreateCollab", actor: ANA, title: "Team pizza night", description: "Pool props for a Friday pizza night for the whole floor.", goal: 120, deadline: NOW + 20 * DAY, autoApprove: false }, NOW - 10 * DAY)) as {
    collabId: string;
  } | null;
  if (collab) {
    for (const [i, who] of ["isabel-cruz", "julian-ortega", "diego-ruiz", "elena-vargas"].entries()) {
      await run(`collab:1:give:${i}`, { type: "Contribute", actor: actorOf(who), collabId: collab.collabId, memberId: m(who), amount: 10 + i * 5 }, NOW - (8 - i) * DAY);
    }
  }

  // Quests (S64-S67).
  const quest = (id: string, title: string, description: string, reward: unknown, extra: Record<string, unknown> = {}) => ({
    id,
    title,
    description,
    image: null,
    reward,
    submitters: "both",
    proofRequired: false,
    approvalRequired: true,
    timeline: true,
    perSubmitterCap: null,
    teamCap: null,
    cooldownMs: 0,
    opensAt: null,
    closesAt: null,
    trigger: null,
    ...extra,
  });
  await run("quest:1", { type: "DefineQuest", actor: ANA, quest: quest("q-mentor", "Mentor a new joiner", "Spend an hour with someone in their first month.", { mode: "fixed", amount: 10 }) }, NOW - 30 * DAY);
  await run("quest:1:open", { type: "PublishQuest", actor: ANA, questId: "q-mentor" }, NOW - 30 * DAY);
  await run("quest:2", { type: "DefineQuest", actor: ANA, quest: quest("q-talk", "Give a lightning talk", "Share something you learned in 5 minutes at the Friday demo.", { mode: "approver_choice" }, { proofRequired: true }) }, NOW - 25 * DAY);
  await run("quest:2:open", { type: "PublishQuest", actor: ANA, questId: "q-talk" }, NOW - 25 * DAY);
  await run("quest:3", { type: "DefineQuest", actor: ANA, quest: quest("q-docs", "Fix a doc you tripped on", "Leave the docs better than you found them.", { mode: "fixed", amount: 3 }, { approvalRequired: false }) }, NOW - 25 * DAY);
  await run("quest:3:open", { type: "PublishQuest", actor: ANA, questId: "q-docs" }, NOW - 25 * DAY);
  const sub = (label: string, who: string, questId: string, ago: number, proof: string | null = null) =>
    run(label, { type: "SubmitQuest", actor: actorOf(who), questId, memberId: m(who), proof, note: "Done!" }, NOW - ago * DAY) as Promise<{ submissionId: string } | null>;
  const s1 = await sub("sub:1", "felipe-soto", "q-mentor", 12);
  if (s1) await run("sub:1:review", { type: "ReviewSubmission", actor: BRUNO, submissionId: s1.submissionId, verdict: "approve", amount: null, note: "Thanks Felipe!" }, NOW - 11 * DAY);
  await sub("sub:2", "gabriela-rios", "q-talk", 2, "https://example.com/slides/observability-101");
  await sub("sub:3", "isabel-cruz", "q-mentor", 1);
  await sub("sub:4", "hugo-paredes", "q-docs", 3);

  // Award rules (S60).
  await run("rule:1", { type: "DefineAwardRule", actor: ANA, rule: { id: "r-top-month", name: "Top receiver of the month", period: "month", criterion: { kind: "top_receivers", n: 1 }, reward: 20, announceChannel: "C-general" } }, NOW - 50 * DAY);
  await run("rule:2", { type: "DefineAwardRule", actor: ANA, rule: { id: "r-generous", name: "Generous week", period: "week", criterion: { kind: "distinct_receivers", k: 4 }, reward: 5, announceChannel: null } }, NOW - 50 * DAY);

  // Stickers (S73), module on.
  await run("stickers:on", { type: "ConfigureStickers", actor: ANA, enabled: true }, NOW - 50 * DAY);
  await run("sticker:1", { type: "DefineSticker", actor: ANA, sticker: { id: "s-trophy", name: "Trophy", image: null, receivers: 1, unitsPerReceiver: 5 } }, NOW - 50 * DAY);
  await run("sticker:2", { type: "DefineSticker", actor: ANA, sticker: { id: "s-high-five", name: "High Five", image: null, receivers: 3, unitsPerReceiver: 1 } }, NOW - 50 * DAY);

  // Milestones (S92).
  await run("milestones:carla", { type: "SetMilestones", actor: actorOf("carla-mendez"), memberId: m("carla-mendez"), birthday: { month: 3, day: 14 }, startDate: "2023-02-01", visibility: "public" }, NOW - 40 * DAY);

  console.log(failures === 0 ? "Done." : `Done with ${failures} refused command(s) (see above).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
