// Workspace settings (S1-S3 plus the toggles giving reads).
import type { PosInt } from "../shared/types.ts";
import type { Currency } from "./currency.ts";
import type { Locale } from "../i18n/locale.ts";

export interface WorkspaceSettings {
  readonly timezone: string; // IANA (S3)
  readonly currency: Currency; // S1, S2
  readonly defaultDailyAllowance: PosInt; // S25
  readonly adminDailyAllowance: PosInt; // S26
  readonly reactionsEnabled: boolean; // S18
  readonly groupMentionsEnabled: boolean; // S12 (default true)
  readonly privateChannelsAllowed: boolean; // S16
  readonly storeMessageText: boolean; // S14, S70
  readonly botsMayGive: boolean; // S8
  /** i18n S3, S4b: the workspace default language. Absent (settings saved before i18n) reads as en. */
  readonly language?: Locale;
}

export function defaultSettings(over: Partial<WorkspaceSettings> = {}): WorkspaceSettings {
  return {
    timezone: "UTC",
    currency: { primaryEmoji: ":taco:", singular: "taco", plural: "tacos", extraEmojis: new Map() },
    defaultDailyAllowance: 5 as PosInt,
    adminDailyAllowance: 5 as PosInt,
    reactionsEnabled: true,
    groupMentionsEnabled: true,
    privateChannelsAllowed: false,
    storeMessageText: true,
    botsMayGive: false,
    ...over,
  };
}
