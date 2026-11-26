// i18n S1: group rewards, where members pool props toward a shared reward.
import { defineMessages } from "@propi/core/i18n";

export const collabsPage = defineMessages(
  {
    title: "Group rewards",
    eyebrow: "Better together",
    empty: "No group rewards yet",
    emptyBody: "Admins can start one, and everyone can chip in.",
    until: "Until {date}",
    noDeadline: "No deadline",
    of: "of {goal} · {pct}%",
    contributors: { one: "{count} contributor", other: "{count} contributors" },
    youGave: " · you gave {amount}",
    amount: "Amount",
    amountAria: "Amount to contribute",
    chipIn: "Chip in",
  },
  {
    title: "Recompensas grupales",
    eyebrow: "Mejor en equipo",
    empty: "Todavía no hay recompensas grupales",
    emptyBody: "Los admins pueden crear una y todos pueden aportar.",
    until: "Hasta el {date}",
    noDeadline: "Sin fecha límite",
    of: "de {goal} · {pct}%",
    contributors: { one: "{count} persona aportó", other: "{count} personas aportaron" },
    youGave: " · tú aportaste {amount}",
    amount: "Cantidad",
    amountAria: "Cantidad para aportar",
    chipIn: "Aportar",
  },
);
