// Presentation helpers. No business rules: amounts, states and permissions come from core.

/**
 * The fallback label when a member has no stored display name (S6), derived from the member id:
 * slug-like ids ("ana-torres") become "Ana Torres"; opaque ids (UUIDs) become "Member 3f1c0a".
 */
export function memberLabel(id: string): string {
  const slug = id.replace(/^m[_-]/, "");
  if (/^[a-z]+([._-][a-z]+)*$/i.test(slug)) return slug.split(/[._-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return `Member ${id.replace(/-/g, "").slice(-6)}`;
}

/** S6: labels and avatars from stored chat profiles, falling back to memberLabel for the rest. */
export function memberDirectory(members: readonly { readonly id: string; readonly displayName?: string | null; readonly avatarUrl?: string | null }[]): {
  label(id: string | null | undefined): string;
  avatar(id: string | null | undefined): string | null;
} {
  const byId = new Map(members.map((m) => [m.id, m]));
  return {
    label: (id) => (id ? byId.get(id)?.displayName || memberLabel(id) : "Someone"),
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

export function formatDate(ms: number, timeZone: string, withTime = false): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(ms);
}

export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** Friendly text for a domain or API error code. Unknown codes fall back to the code itself. */
export function errorMessage(error: { readonly code: string; readonly [k: string]: unknown }): string {
  const e = error as Record<string, unknown>;
  switch (error.code) {
    case "forbidden":
      return `You need the ${String(e.need ?? "right")} role for that.`;
    case "insufficient_redeemable":
      return `Not enough redeemable balance: it costs ${String(e.cost)}, you have ${String(e.redeemable)}.`;
    case "out_of_stock":
      return "That reward is out of stock right now.";
    case "plan_limit":
      return "Your workspace is over the Free plan limit. Ask an admin to upgrade to Pro.";
    case "billing_not_configured":
      return "Billing is not configured on this Propi server.";
    case "billing_unavailable":
      return "Billing is unavailable right now. Try again in a minute.";
    case "budget_exceeded":
      return "This month's redemption budget would be exceeded.";
    case "reason_required":
      return "Please add a reason.";
    case "invalid_amount":
      return "The amount must be a whole number of at least 1.";
    case "idempotency_key_reused":
      return "That form was already submitted with different values. Reload and try again.";
    case "illegal_transition":
    case "invalid_transition":
      return "That item can no longer move to that state.";
    case "invalid_reward":
      return `Please check the reward field "${String(e.field ?? "")}".`;
    case "quest_not_open":
      return "That quest is not open for submissions.";
    case "proof_required":
      return "This quest needs proof.";
    case "cooldown":
      return "You are still in this quest's cooldown.";
    case "cap_reached":
      return "This quest's submission cap is reached.";
    case "collab_closed":
      return "That collaborative reward is closed.";
    case "avatar_locked":
      return `That avatar unlocks at level ${String(e.minLevel)}.`;
    case "module_disabled":
      return "That module is turned off for this workspace.";
    case "reward_not_active":
      return "Only active rewards can be redeemed.";
    case "unknown_member":
      return "That member does not exist in this workspace.";
    case "invalid_field":
      return `Please check the field "${String(e.field ?? "")}".`;
    case "invalid_currency":
      return `The currency ${String(e.field ?? "")} is not valid.`;
    case "not_found":
      return `Not found: ${String(e.what ?? "item")}.`;
    default:
      return error.code.replace(/_/g, " ");
  }
}
