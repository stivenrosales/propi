// i18n S1: the TV display for an office screen (live feed and leaderboard, no sign-in).
import { defineMessages } from "@propi/core/i18n";

export const tvPage = defineMessages(
  {
    title: "TV",
    invalid: "This display link is not valid. Ask an admin for the TV link in Settings.",
    live: "Live · this {period}",
    "period.today": "day",
    "period.week": "week",
    "period.month": "month",
    "period.year": "year",
    "board.received": "Most appreciated",
    "board.given": "Most generous",
    "board.combined": "Top contributors",
    fresh: "Fresh {currency}",
  },
  {
    title: "TV",
    invalid: "Este enlace de pantalla no es válido. Pídele a un admin el enlace de TV que está en Configuración.",
    live: "En vivo · {period}",
    "period.today": "hoy",
    "period.week": "esta semana",
    "period.month": "este mes",
    "period.year": "este año",
    "board.received": "Los más reconocidos",
    "board.given": "Los más generosos",
    "board.combined": "Los que más aportan",
    fresh: "{currency} recientes",
  },
);
