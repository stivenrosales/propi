// i18n S1, S2: the shop in Slack (/propi shop, App Home), the "Redeem more" quantity picker and
// /propi balance. Reward titles and the currency's names are workspace data.
import { defineMessages } from "@propi/core/i18n";

export const shop = defineMessages(
  {
    "balance.text": "You can spend {spend} and give {give} more today.",
    "balance.blocks": "*You can spend:* {spend}\n*Left to give today:* {left} of {limit}\n*Received:* {received} · *Given:* {given}",
    "picker.placeholder": "Redeem more",
    "picker.title": "Redeem several?",
    "picker.text": "Spend the total shown for *{title}*? One approval covers every unit.",
    "confirm.title": "Redeem?",
    "confirm.text": "Spend {cost} on *{label}*?",
    redeem: "Redeem",
    redeemVariant: "Redeem {name}",
    cancel: "Cancel",
    stockLeft: { one: "{count} left", other: "{count} left" },
    outOfStock: "Out of stock",
    needMore: "You need {amount} more",
    empty: "The shop is empty for now.",
    seeAll: "See all {count} rewards",
    "message.text": "The shop. You can spend {amount}.",
    "message.header": "*The shop* · you can spend {amount}",
  },
  {
    "balance.text": "Puedes canjear {spend} y dar {give} más hoy.",
    "balance.blocks": "*Puedes canjear:* {spend}\n*Te quedan por dar hoy:* {left} de {limit}\n*Recibidos:* {received} · *Enviados:* {given}",
    "picker.placeholder": "Canjear más",
    "picker.title": "¿Canjear varios?",
    "picker.text": "¿Gastar el total indicado en *{title}*? Una sola aprobación cubre todas las unidades.",
    "confirm.title": "¿Canjear?",
    "confirm.text": "¿Gastar {cost} en *{label}*?",
    redeem: "Canjear",
    redeemVariant: "Canjear {name}",
    cancel: "Cancelar",
    stockLeft: { one: "queda {count}", other: "quedan {count}" },
    outOfStock: "Agotado",
    needMore: "Te faltan {amount}",
    empty: "La tienda está vacía por ahora.",
    seeAll: "Ver los {count} premios",
    "message.text": "La tienda. Puedes canjear {amount}.",
    "message.header": "*La tienda* · puedes canjear {amount}",
  },
);
