// i18n S1: the admin Export page and its CSV download route.
import { defineMessages } from "@propi/core/i18n";

export const exportPage = defineMessages(
  {
    title: "Export",
    eyebrow: "Admin",
    "gifts.title": "Gifts",
    "gifts.text": "Every gift header: giver, channel, text and value tags.",
    "ledger.title": "Ledger",
    "ledger.text": "Every ledger entry in commit order.",
    "redemptions.title": "Redemptions",
    "redemptions.text": "Every redemption and its state.",
    "members.title": "Members",
    "members.text": "Every member, role and status.",
    notFound: "Not found",
    signIn: "Sign in first",
    adminsOnly: "Admins only",
  },
  {
    title: "Exportar",
    eyebrow: "Admin",
    "gifts.title": "Regalos",
    "gifts.text": "Cada regalo: quién dio, canal, texto y etiquetas de valores.",
    "ledger.title": "Registro contable",
    "ledger.text": "Cada movimiento del registro, en el orden en que se guardó.",
    "redemptions.title": "Canjes",
    "redemptions.text": "Cada canje y su estado.",
    "members.title": "Miembros",
    "members.text": "Cada miembro, su rol y su estado.",
    notFound: "No encontrado",
    signIn: "Primero inicia sesión",
    adminsOnly: "Solo para admins",
  },
);
