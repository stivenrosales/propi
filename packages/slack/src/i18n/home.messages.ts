// i18n S1, S2: the App Home tab and the /propi help reply. Slash subcommands (`/propi balance`…)
// are what people type, so they stay as they are in both languages.
import { defineMessages } from "@propi/core/i18n";

export const home = defineMessages(
  {
    title: "{emoji} Your {plural}",
    received: "*Received*\n{value}",
    given: "*Given*\n{value}",
    spend: "*You can spend*\n{value}",
    left: "*Left to give today*\n{left} of {limit}",
    level: ":star: Level {level} · {title}",
    upgrade:
      ":warning: *Your workspace is over the Free plan limit ({active} of {limit} active members).* Recognition keeps working, but the shop takes no new redemptions. {link}",
    upgradeLink: "Upgrade to Pro",
    upgradeNoLink: "Upgrade to Pro in the web admin",
    dashboard: "Open your dashboard",
    shopLink: "{Plural} shop",
    leaderboard: ":trophy: Leaderboard",
    thisMonth: "*This month*\n{rows}",
    allTime: "*All time*\n{rows}",
    noneYet: "_No {plural} yet._",
    shop: ":shopping_bags: Shop",
    shopSpend: "You can spend {amount}",
    howTo: "*How to give:* mention someone and add {emoji} with a reason, e.g. `@ana thanks for the review {emoji}{emoji}`, or react with {emoji}. Type `/propi help` for more.",
    "help.title": "How Propi works",
    "help.give": "*Give:* mention someone and add {emoji} in a channel, e.g. `@ana thanks for the review {emoji}{emoji}`. React with {emoji} to give too.",
    "help.commands":
      "*Commands:*\n`/propi balance` your balance and what you can still give today\n`/propi shop` rewards you can redeem\n`/propi sticker <id> @someone` give a sticker (when stickers are on)\n`/propi help` this message",
  },
  {
    title: "{emoji} Tus {plural}",
    received: "*Recibidos*\n{value}",
    given: "*Enviados*\n{value}",
    spend: "*Puedes canjear*\n{value}",
    left: "*Te quedan por dar hoy*\n{left} de {limit}",
    level: ":star: Nivel {level} · {title}",
    upgrade:
      ":warning: *Tu espacio de trabajo superó el límite del plan Free ({active} de {limit} miembros activos).* El reconocimiento sigue funcionando, pero la tienda no acepta canjes nuevos. {link}",
    upgradeLink: "Pasar a Pro",
    upgradeNoLink: "Pasa a Pro desde el admin web",
    dashboard: "Abrir tu panel",
    shopLink: "Tienda de {Plural}",
    leaderboard: ":trophy: Ranking",
    thisMonth: "*Este mes*\n{rows}",
    allTime: "*Histórico*\n{rows}",
    noneYet: "_Todavía no hay {plural}._",
    shop: ":shopping_bags: Tienda",
    shopSpend: "Puedes canjear {amount}",
    howTo: "*Cómo dar:* menciona a alguien y agrega {emoji} con un motivo, por ejemplo `@ana gracias por la revisión {emoji}{emoji}`, o reacciona con {emoji}. Escribe `/propi help` para ver más.",
    "help.title": "Cómo funciona Propi",
    "help.give": "*Dar:* menciona a alguien y agrega {emoji} en un canal, por ejemplo `@ana gracias por la revisión {emoji}{emoji}`. También puedes reaccionar con {emoji} para dar.",
    "help.commands":
      "*Comandos:*\n`/propi balance` tu saldo y lo que todavía puedes dar hoy\n`/propi shop` los premios que puedes canjear\n`/propi sticker <id> @alguien` da un sticker (si los stickers están activos)\n`/propi help` este mensaje",
  },
);
