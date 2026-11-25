// The engagement modules (rules, quests, stickers, levels, milestones, pairing) keep their state in
// their own stores, so their handlers are built from those stores at the composition root:
//   createApp(ports, { handlers: engagementHandlers({ reader, directory, rules, quests, ... }) })
import type { Ports } from "@propi/core";
import type { RegisteredHandler } from "./handler.ts";
import { levelHandlers } from "./levels/handlers.ts";
import type { LevelStore } from "./levels/core.ts";
import { milestoneHandlers } from "./milestones/handlers.ts";
import type { MilestoneStore } from "./milestones/core.ts";
import { pairingHandlers } from "./pairing/handlers.ts";
import type { PairingStore } from "./pairing/core.ts";
import { questHandlers } from "./quests/handlers.ts";
import type { QuestStore } from "./quests/core.ts";
import { ruleHandlers } from "./rules/handlers.ts";
import type { RuleStore } from "./rules/core.ts";
import { stickerHandlers } from "./stickers/handlers.ts";
import type { StickerStore } from "./stickers/core.ts";

export interface EngagementDeps {
  readonly reader: Ports["reader"];
  readonly directory: Ports["directory"];
  readonly rules: RuleStore;
  readonly quests: QuestStore;
  readonly stickers: StickerStore;
  readonly levels: LevelStore;
  readonly milestones: MilestoneStore;
  readonly pairing: PairingStore;
}

/** Every engagement handler, wired to `deps`; pass them to createApp({ handlers }). */
export function engagementHandlers(deps: EngagementDeps): RegisteredHandler[] {
  return [...ruleHandlers(deps), ...questHandlers(deps), ...stickerHandlers(deps), ...levelHandlers(deps), ...milestoneHandlers(deps), ...pairingHandlers(deps)];
}
