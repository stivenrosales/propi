// WorkspaceSettings <-> workspace.settings JSONB. Maps become [key, value] pairs.
import type { PosInt, WorkspaceSettings } from "@propi/core";

export function settingsToJson(s: WorkspaceSettings): unknown {
  return { ...s, currency: { ...s.currency, extraEmojis: [...s.currency.extraEmojis.entries()] } };
}

export function settingsFromJson(json: unknown): WorkspaceSettings {
  const raw = json as WorkspaceSettings & { currency: { extraEmojis: [string, number][] } };
  return { ...raw, currency: { ...raw.currency, extraEmojis: new Map(raw.currency.extraEmojis.map(([e, v]) => [e, v as PosInt])) } };
}

/** JSON for JSONB columns: Maps become objects, Sets arrays. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v));
}
