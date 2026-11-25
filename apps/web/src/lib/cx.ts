// Joins class names and lets a later utility override an earlier one of the same group,
// so `<Card className="bg-ink">` beats the card's built-in `bg-white`. It covers the groups
// the primitives override (background, padding, margin, gap, text size and color, border
// width and color, radius, min-height); anything else is kept as written.

const TEXT_SIZE = /^text-(xs|sm|base|lg|xl|\dxl)$/;
const BORDER_WIDTH = /^border(-[xytrbl])?(-\d+)?$/;

function group(utility: string): string | null {
  if (utility.startsWith("bg-")) return "bg";
  const spacing = /^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap-x|gap-y|gap)-/.exec(utility);
  if (spacing) return spacing[1]!;
  if (utility.startsWith("text-")) return TEXT_SIZE.test(utility) ? "text-size" : "text-color";
  if (BORDER_WIDTH.test(utility)) return `border-width${utility.match(/^border(-[xytrbl])?/)?.[1] ?? ""}`;
  if (utility.startsWith("border-")) return "border-color";
  if (utility === "rounded" || utility.startsWith("rounded-")) return "rounded";
  if (utility.startsWith("min-h-")) return "min-h";
  return null;
}

/** Variant prefix (e.g. `md:hover:`) plus the utility's group, or null when it never conflicts. */
function key(token: string): string | null {
  const cut = token.lastIndexOf(":");
  const variants = token.slice(0, cut + 1);
  const utility = token.slice(cut + 1).replace(/^!/, "");
  const g = group(utility);
  return g ? variants + g : null;
}

export function cx(...classes: (string | false | null | undefined)[]): string {
  const tokens = classes.filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
  const last = new Map<string, number>();
  tokens.forEach((t, i) => {
    const k = key(t);
    if (k) last.set(k, i);
  });
  return tokens.filter((t, i) => {
    const k = key(t);
    return !k || last.get(k) === i;
  }).join(" ");
}
