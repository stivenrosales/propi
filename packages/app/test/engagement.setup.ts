// Shared setup for the engagement use-case tests (rules, quests, stickers, levels, milestones, pairing).
import type { CommandBase, Result, WorkspaceSettings } from "@propi/core";
import { createApp } from "../src/index.ts";
import { createEngagementMemory } from "../src/testing/engagement.ts";
import type { MemoryOptions } from "../src/testing/index.ts";
import { setup } from "./setup.ts";

export function engagementSetup(opts: MemoryOptions & { settings?: Partial<WorkspaceSettings> } = {}) {
  const { mem } = setup(opts);
  const eng = createEngagementMemory(mem);
  const app = createApp(eng.ports, { handlers: eng.handlers });
  /** Engagement commands are registered through options.handlers until registry.ts lists them. */
  const run = <T = unknown, C extends CommandBase & { readonly type: string } = CommandBase & { readonly type: string }>(cmd: C) => app.executeAny(cmd) as Promise<Result<T>>;
  return { mem, eng, app, run };
}
