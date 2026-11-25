// S68: event-triggered quest completion. A pure map from one committed domain event to
// SubmitQuest commands; the relay executes them. Keys are deterministic, so a replayed event
// produces the same keys and the command log dedupes them.
import type { CommandKey, Instant, MemberId, WorkspaceId } from "../shared/types.ts";
import type { Quest, SubmitQuest } from "./types.ts";

/** One outbox row: the event plus the command that produced it. */
export interface TriggerSource {
  readonly workspaceId: WorkspaceId;
  readonly commandKey: CommandKey;
  readonly at: Instant;
  /** Any domain event; only the ones a quest trigger names are matched. */
  readonly event: { readonly type: string };
}

export const questTriggerKey = (questId: string, member: MemberId, source: CommandKey): CommandKey =>
  `quest:${questId}:auto:${member}:${source}` as CommandKey;

function membersFor(quest: Quest, event: { readonly type: string }): MemberId[] {
  const trigger = quest.trigger;
  if (trigger === null || event.type !== trigger.event) return [];
  const e = event as { readonly giver?: unknown; readonly receivers?: unknown };
  if (trigger.who === "giver") return typeof e.giver === "string" && !e.giver.startsWith("bot:") ? [e.giver as MemberId] : [];
  return Array.isArray(e.receivers) ? (e.receivers.filter((r) => typeof r === "string") as MemberId[]) : [];
}

/** S68: SubmitQuest commands for every open quest whose trigger matches the event. */
export function questSubmissionsFor(quests: readonly Quest[], source: TriggerSource): SubmitQuest[] {
  const out: SubmitQuest[] = [];
  for (const quest of quests) {
    if (quest.state !== "open") continue;
    for (const memberId of membersFor(quest, source.event)) {
      out.push({
        type: "SubmitQuest",
        key: questTriggerKey(quest.id, memberId, source.commandKey),
        workspaceId: source.workspaceId,
        actor: { kind: "system", job: "quest-trigger" },
        at: source.at,
        questId: quest.id,
        memberId,
        proof: null,
        note: null,
      });
    }
  }
  return out;
}
