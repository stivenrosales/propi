// Turns the admin settings form into WorkspaceSettings. Validation is core's (validateCurrency, PosInt);
// this only reads fields. Framework-free so it is unit-tested.
import { isPosInt, validateCurrency, type DomainError, type PosInt, type WorkspaceSettings } from "@propi/core";

export type SettingsOutcome = { readonly ok: true; readonly value: WorkspaceSettings } | { readonly ok: false; readonly error: DomainError | { readonly code: "invalid_field"; readonly field: string } };

const read = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const on = (form: FormData, name: string) => form.get(name) === "on";

/** ":fire: = 3, :star: = 2" → Map. A malformed pair is kept as NaN so core rejects it. */
export function parseExtraEmojis(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of text.split(/[,\n]/)) {
    const t = part.trim();
    if (t === "") continue;
    const [emoji = "", value = ""] = t.split("=").map((s) => s.trim());
    out.set(emoji, /^\d+$/.test(value) ? Number(value) : Number.NaN);
  }
  return out;
}

export const formatExtraEmojis = (m: ReadonlyMap<string, number>): string => [...m].map(([e, v]) => `${e} = ${v}`).join(", ");

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz !== "";
  } catch {
    return false;
  }
}

/** S1-S3, S8, S12, S14, S16, S18, S25-S26. Currency changes only affect future gifts (S4): nothing is rewritten. */
export function parseWorkspaceSettings(form: FormData, current: WorkspaceSettings): SettingsOutcome {
  const currency = {
    primaryEmoji: read(form, "primaryEmoji"),
    singular: read(form, "singular"),
    plural: read(form, "plural"),
    // Unchecked here on purpose: validateCurrency rejects any value that is not a PosInt.
    extraEmojis: parseExtraEmojis(read(form, "extraEmojis")) as Map<string, PosInt>,
  };
  const bad = validateCurrency(currency);
  if (bad !== null) return { ok: false, error: bad };
  for (const e of currency.extraEmojis.keys()) if (!/^:[\w+-]+:$/.test(e)) return { ok: false, error: { code: "invalid_currency", field: "extraEmojis" } };
  const timezone = read(form, "timezone");
  if (!isTimeZone(timezone)) return { ok: false, error: { code: "invalid_field", field: "timezone" } };
  const daily = Number(read(form, "defaultDailyAllowance"));
  const adminDaily = Number(read(form, "adminDailyAllowance"));
  if (!isPosInt(daily)) return { ok: false, error: { code: "invalid_field", field: "defaultDailyAllowance" } };
  if (!isPosInt(adminDaily)) return { ok: false, error: { code: "invalid_field", field: "adminDailyAllowance" } };
  return {
    ok: true,
    value: {
      ...current,
      timezone,
      currency,
      defaultDailyAllowance: daily as PosInt,
      adminDailyAllowance: adminDaily as PosInt,
      reactionsEnabled: on(form, "reactionsEnabled"),
      groupMentionsEnabled: on(form, "groupMentionsEnabled"),
      privateChannelsAllowed: on(form, "privateChannelsAllowed"),
      storeMessageText: on(form, "storeMessageText"),
      botsMayGive: on(form, "botsMayGive"),
    },
  };
}
