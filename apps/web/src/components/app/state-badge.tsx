import { getLocale } from "@/i18n/locale";
import { shell, stateName } from "@/i18n/app-shell.messages";
import { Badge } from "./ui";

const TONE = {
  pending: "sunflower",
  approved: "coral",
  fulfilled: "mint",
  rejected: "muted",
  cancelled: "muted",
  open: "mint",
  draft: "muted",
  closed: "ink",
  active: "mint",
  archived: "ink",
  completed: "coral",
  delivered: "mint",
  refunded: "muted",
} as const;

/** A lifecycle state as a colored pill (S45, S49, S58, S65, S66). */
export async function StateBadge({ state }: { state: string }) {
  const t = shell.t(await getLocale());
  return <Badge tone={TONE[state as keyof typeof TONE] ?? "muted"}>{stateName(t, state)}</Badge>;
}
