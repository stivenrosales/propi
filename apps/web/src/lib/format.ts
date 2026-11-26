// Presentation helpers. No business rules: amounts, states and permissions come from core.
// i18n S1: every text and format here takes the reader's locale (en | es).
import { formatDate as formatLocaleDate, formatNumber, type Locale } from "@propi/core/i18n";
import { errors } from "../i18n/errors.messages.ts";

/**
 * The fallback label when a member has no stored display name (S6), derived from the member id:
 * slug-like ids ("ana-torres") become "Ana Torres"; opaque ids (UUIDs) become "Member 3f1c0a".
 */
export function memberLabel(id: string, locale: Locale = "en"): string {
  const slug = id.replace(/^m[_-]/, "");
  if (/^[a-z]+([._-][a-z]+)*$/i.test(slug)) return slug.split(/[._-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return errors.t(locale)("member.fallback", { suffix: id.replace(/-/g, "").slice(-6) });
}

/** S6: labels and avatars from stored chat profiles, falling back to memberLabel for the rest. */
export function memberDirectory(
  members: readonly { readonly id: string; readonly displayName?: string | null; readonly avatarUrl?: string | null }[],
  locale: Locale,
): {
  label(id: string | null | undefined): string;
  avatar(id: string | null | undefined): string | null;
} {
  const byId = new Map(members.map((m) => [m.id, m]));
  return {
    label: (id) => (id ? byId.get(id)?.displayName || memberLabel(id, locale) : errors.t(locale)("member.someone")),
    avatar: (id) => (id ? byId.get(id)?.avatarUrl || null : null),
  };
}

/** Gift text as people read it: Slack-style `<@member>` mentions become "@Name". */
export function readableText(text: string, label: (id: string) => string = memberLabel): string {
  return text
    .replace(/<@([^>|]+)(?:\|[^>]*)?>/g, (_, id: string) => `@${label(id)}`)
    // Slack emoji codes (:propi:, :+1::skin-tone-2:) are noise outside Slack.
    .replace(/:[a-z0-9_+'-]*[a-z_+'-][a-z0-9_+'-]*:/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function initials(label: string): string {
  const parts = label.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

const HUES = ["var(--sunflower)", "var(--mint)", "color-mix(in oklch, var(--coral), var(--cream) 35%)", "color-mix(in oklch, var(--sunflower), var(--cream) 30%)", "color-mix(in oklch, var(--mint), var(--cream) 30%)"];

/** A stable brand tint per member. */
export function memberHue(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
}

export function unitsWord(n: number, currency: { readonly singular: string; readonly plural: string }): string {
  return n === 1 ? currency.singular : currency.plural;
}

export function formatDate(locale: Locale, ms: number, timeZone: string, withTime = false): string {
  return formatLocaleDate(locale, ms, { timeZone, month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) });
}

export function formatMoney(locale: Locale, minor: number, currency: string): string {
  try {
    return formatNumber(locale, minor / 100, { style: "currency", currency });
  } catch {
    return `${formatNumber(locale, minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
}

const ROLES = new Set(["admin", "approver", "member"]);

/** The label of a form field an error names: known fields in the reader's language, others as given. */
function fieldLabel(t: ReturnType<typeof errors.t>, field: unknown): string {
  const f = String(field ?? "");
  const hashtag = /^hashtag of (.+)$/.exec(f);
  if (hashtag) return t("field.hashtagOf", { name: hashtag[1]! });
  const emoji = /^emoji of (.+)$/.exec(f);
  if (emoji) return t("field.emojiOf", { name: emoji[1]! });
  const key = `field.${f}`;
  return key in errors.en ? t(key as "field.title") : f;
}

/** Friendly text for a domain or API error code, in the reader's language. Unknown codes fall back to the code itself. */
export function errorMessage(locale: Locale, error: { readonly code: string; readonly [k: string]: unknown }): string {
  const e = error as Record<string, unknown>;
  const t = errors.t(locale);
  const num = (v: unknown): string | number => (typeof v === "number" ? v : String(v));
  switch (error.code) {
    case "forbidden":
      return ROLES.has(String(e.need)) ? t("forbidden", { role: t(`role.${String(e.need)}` as "role.admin") }) : t("forbidden.any");
    case "insufficient_redeemable":
      return t("insufficient_redeemable", { cost: num(e.cost), redeemable: num(e.redeemable) });
    case "out_of_stock":
      return typeof e.available === "number" ? t("out_of_stock.some", { available: e.available }) : t("out_of_stock");
    case "invalid_quantity":
    case "plan_limit":
    case "billing_not_configured":
    case "billing_unavailable":
    case "already_subscribed":
    case "budget_exceeded":
    case "reason_required":
    case "invalid_amount":
    case "idempotency_key_reused":
    case "quest_not_open":
    case "proof_required":
    case "cooldown":
    case "cap_reached":
    case "collab_closed":
    case "module_disabled":
    case "reward_not_active":
    case "unknown_member":
      return t(error.code as "plan_limit");
    case "illegal_transition":
    case "invalid_transition":
      return t("invalid_transition");
    case "invalid_reward":
      return t("invalid_reward", { field: fieldLabel(t, e.field) });
    case "avatar_locked":
      return t("avatar_locked", { level: num(e.minLevel) });
    case "invalid_field":
      return t("invalid_field", { field: fieldLabel(t, e.field) });
    case "invalid_currency":
      return t("invalid_currency", { currency: String(e.field ?? "") });
    case "not_found":
      return t("not_found", { what: e.what === "endpoint" ? t("not_found.endpoint") : e.what === undefined ? t("not_found.item") : String(e.what) });
    default:
      return error.code.replace(/_/g, " ");
  }
}
