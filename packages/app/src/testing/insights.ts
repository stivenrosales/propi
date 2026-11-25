// In-memory InsightsSource for the boards/notify/insights/privacy queries. Gift headers come from
// the memory ports; settings, preferences and redemption export rows are held here.
import type { MemberId, WorkspaceId } from "@propi/core";
import { defaultInsightsSettings, type InsightsSettings, type InsightsSource } from "@propi/core/boards";
import type { NotificationPreferences } from "@propi/core/notify";
import type { ExportRedemptionRow } from "@propi/core/privacy";
import type { MemoryPorts } from "./memory.ts";

export function createMemoryInsights(mem: MemoryPorts) {
  const settings = new Map<WorkspaceId, InsightsSettings>();
  const prefs = new Map<WorkspaceId, Map<MemberId, NotificationPreferences>>();
  const redemptions = new Map<WorkspaceId, ExportRedemptionRow[]>();
  const yieldNow = () => Promise.resolve();

  const source: InsightsSource = {
    async gifts(ws) {
      await yieldNow();
      return mem.gifts(ws);
    },
    async settings(ws) {
      await yieldNow();
      return settings.get(ws) ?? defaultInsightsSettings();
    },
    async preferences(ws) {
      await yieldNow();
      return new Map(prefs.get(ws) ?? []);
    },
    async redemptions(ws) {
      await yieldNow();
      return [...(redemptions.get(ws) ?? [])];
    },
  };

  return {
    source,
    /** Merges over the current settings. */
    setSettings(ws: WorkspaceId, over: Partial<InsightsSettings>) {
      settings.set(ws, { ...(settings.get(ws) ?? defaultInsightsSettings()), ...over });
    },
    setPreferences(ws: WorkspaceId, member: MemberId, p: NotificationPreferences) {
      let m = prefs.get(ws);
      if (!m) prefs.set(ws, (m = new Map()));
      m.set(member, p);
    },
    addRedemption(ws: WorkspaceId, row: ExportRedemptionRow) {
      const list = redemptions.get(ws) ?? [];
      list.push(row);
      redemptions.set(ws, list);
    },
  };
}

export type MemoryInsights = ReturnType<typeof createMemoryInsights>;
