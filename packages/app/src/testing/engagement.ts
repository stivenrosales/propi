// In-memory stores for the engagement modules (rules, quests, stickers, levels, milestones, pairing).
// It wraps the memory ports' unit of work: engagement state writes are prepared before the inner
// commit and applied right after it, so they persist with the ledger entries or not at all.
// The rest of a decision (entries, events, gift.upsert) goes through the normal memory commit.
import type { Commit, MemberId, Ports, StateWrite, Tx, WorkspaceId } from "@propi/core";
import { engagementHandlers, type EngagementDeps } from "../engagement.ts";
import { DEFAULT_LEVEL_CONFIG, type LevelConfig, type LevelStore, type LevelWrite } from "../levels/core.ts";
import { DEFAULT_MILESTONES, type MilestoneConfig, type MilestoneProfile, type MilestoneStore, type MilestoneWrite } from "../milestones/core.ts";
import { DEFAULT_PAIRING, type PairingConfig, type PairingRound, type PairingStore, type PairingWrite } from "../pairing/core.ts";
import type { Quest, QuestComment, QuestStore, QuestWrite, Submission } from "../quests/core.ts";
import type { AwardRule, RuleStore, RuleWrite } from "../rules/core.ts";
import { STICKERS_OFF, type StickerConfig, type StickerDef, type StickerGrant, type StickerStore, type StickerUse, type StickerWrite } from "../stickers/core.ts";
import type { MemoryPorts } from "./memory.ts";

export interface EngagementState {
  readonly rules: Map<string, AwardRule>;
  readonly quests: Map<string, Quest>;
  readonly submissions: Map<string, Submission>;
  readonly comments: QuestComment[];
  stickerConfig: StickerConfig;
  readonly stickers: Map<string, StickerDef>;
  readonly grants: StickerGrant[];
  readonly uses: StickerUse[];
  levelConfig: LevelConfig;
  readonly avatars: Map<MemberId, string>;
  milestoneConfig: MilestoneConfig;
  readonly profiles: Map<MemberId, MilestoneProfile>;
  pairingConfig: PairingConfig;
  readonly optIns: Map<MemberId, boolean>;
  readonly rounds: PairingRound[];
}

type EngagementWrite = RuleWrite | QuestWrite | Exclude<StickerWrite, { t: "gift.upsert" }> | LevelWrite | MilestoneWrite | PairingWrite;

const fresh = (): EngagementState => ({
  rules: new Map(),
  quests: new Map(),
  submissions: new Map(),
  comments: [],
  stickerConfig: STICKERS_OFF,
  stickers: new Map(),
  grants: [],
  uses: [],
  levelConfig: DEFAULT_LEVEL_CONFIG,
  avatars: new Map(),
  milestoneConfig: DEFAULT_MILESTONES,
  profiles: new Map(),
  pairingConfig: DEFAULT_PAIRING,
  optIns: new Map(),
  rounds: [],
});

/** One applier per engagement write kind (exhaustive: a new kind fails to compile here). */
const APPLIERS: { readonly [K in EngagementWrite["t"]]: (s: EngagementState, w: Extract<EngagementWrite, { t: K }>) => void } = {
  "rule.upsert": (s, w) => void s.rules.set(w.rule.id, w.rule),
  "quest.upsert": (s, w) => void s.quests.set(w.quest.id, w.quest),
  "submission.upsert": (s, w) => void s.submissions.set(w.submission.id, w.submission),
  "quest.comment": (s, w) => void s.comments.push(w.comment),
  "sticker.config": (s, w) => void (s.stickerConfig = w.config),
  "sticker.upsert": (s, w) => void s.stickers.set(w.sticker.id, w.sticker),
  "sticker.grant": (s, w) => void s.grants.push(w.grant),
  "sticker.used": (s, w) => void s.uses.push(w.use),
  "levels.config": (s, w) => void (s.levelConfig = w.config),
  "avatar.choose": (s, w) => void s.avatars.set(w.memberId, w.avatarId),
  "milestone.profile": (s, w) => void s.profiles.set(w.profile.memberId, w.profile),
  "milestone.config": (s, w) => void (s.milestoneConfig = w.config),
  "pairing.config": (s, w) => void (s.pairingConfig = w.config),
  "pairing.optin": (s, w) => void s.optIns.set(w.memberId, w.optedIn),
  "pairing.round": (s, w) => void s.rounds.push(w.record),
};

const isEngagementWrite = (w: { readonly t: string }): w is EngagementWrite => Object.hasOwn(APPLIERS, w.t);

export { engagementHandlers, type EngagementDeps };

export function createEngagementMemory(mem: MemoryPorts) {
  const states = new Map<WorkspaceId, EngagementState>();
  const st = (ws: WorkspaceId) => {
    let s = states.get(ws);
    if (!s) states.set(ws, (s = fresh()));
    return s;
  };
  const tick = () => Promise.resolve();

  const rules: RuleStore = {
    rules: async (ws) => (await tick(), [...st(ws).rules.values()]),
    rule: async (ws, id) => (await tick(), st(ws).rules.get(id) ?? null),
  };
  const quests: QuestStore = {
    quest: async (ws, id) => (await tick(), st(ws).quests.get(id) ?? null),
    quests: async (ws) => (await tick(), [...st(ws).quests.values()]),
    submission: async (ws, id) => (await tick(), st(ws).submissions.get(id) ?? null),
    submissions: async (ws, questId) => (await tick(), [...st(ws).submissions.values()].filter((x) => x.questId === questId)),
    comments: async (ws, submissionId) => (await tick(), st(ws).comments.filter((c) => c.submissionId === submissionId)),
  };
  const stickers: StickerStore = {
    config: async (ws) => (await tick(), st(ws).stickerConfig),
    sticker: async (ws, id) => (await tick(), st(ws).stickers.get(id) ?? null),
    stickers: async (ws) => (await tick(), [...st(ws).stickers.values()]),
    granted: async (ws, member, stickerId, month) =>
      (await tick(), st(ws).grants.filter((g) => g.memberId === member && g.stickerId === stickerId && g.month === month).reduce((t, g) => t + g.uses, 0)),
    used: async (ws, member, stickerId, month) => (await tick(), st(ws).uses.filter((u) => u.giver === member && u.stickerId === stickerId && u.month === month).length),
  };
  const levels: LevelStore = {
    config: async (ws) => (await tick(), st(ws).levelConfig),
    avatar: async (ws, member) => (await tick(), st(ws).avatars.get(member) ?? null),
  };
  const milestones: MilestoneStore = {
    config: async (ws) => (await tick(), st(ws).milestoneConfig),
    profile: async (ws, member) => (await tick(), st(ws).profiles.get(member) ?? null),
    profiles: async (ws) => (await tick(), [...st(ws).profiles.values()]),
  };
  const pairing: PairingStore = {
    config: async (ws) => (await tick(), st(ws).pairingConfig),
    optedIn: async (ws) => (await tick(), [...st(ws).optIns].filter(([, on]) => on).map(([id]) => id).sort()),
    rounds: async (ws) => (await tick(), [...st(ws).rounds]),
  };

  const wrap = (ws: WorkspaceId, tx: Tx): Tx => ({
    ...tx,
    async commit<T>(c: Commit<T>) {
      const writes = c.decision.writes as readonly { readonly t: string }[];
      const mine = writes.filter(isEngagementWrite);
      const rest = writes.filter((w) => !isEngagementWrite(w)) as StateWrite[];
      await tx.commit({ ...c, decision: { ...c.decision, writes: rest } });
      const s = st(ws);
      for (const w of mine) (APPLIERS[w.t] as (s: EngagementState, w: EngagementWrite) => void)(s, w);
    },
  });

  const ports: Ports = {
    ...mem.ports,
    uow: { run: (ws, locks, fn) => mem.ports.uow.run(ws, locks, (tx) => fn(wrap(ws, tx))) },
  };
  const deps: EngagementDeps = { reader: ports.reader, directory: ports.directory, rules, quests, stickers, levels, milestones, pairing };

  return {
    ports,
    deps,
    handlers: engagementHandlers(deps),
    /** Raw state for assertions. */
    state: (ws: WorkspaceId): Readonly<EngagementState> => st(ws),
  };
}

export type EngagementMemory = ReturnType<typeof createEngagementMemory>;
