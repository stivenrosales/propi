// i18n S1, S2: the server's own replies in Slack (/propi errors, sticker result, button results) and
// the neutral word for a member who has no Slack account linked.
import { defineMessages } from "@propi/core/i18n";

export const replies = defineMessages(
  {
    notInstalled: "Propi is not installed in this workspace.",
    notMember: "Only workspace members can use Propi.",
    stickerSent: { one: "Sticker sent: {count} person got {each} each.", other: "Sticker sent: {count} people got {each} each." },
    redeemed: "Redeemed. It's {state}. You'll get a message as it moves along.",
    redeemedPlain: "Redeemed. You'll get a message as it moves along.",
    redemptionDone: "Done: the redemption is now {state}.",
    submissionDone: "Done: the submission is now {state}.",
    done: "Done.",
    teammate: "a teammate",
  },
  {
    notInstalled: "Propi no está instalado en este espacio de trabajo.",
    notMember: "Solo los miembros del espacio de trabajo pueden usar Propi.",
    stickerSent: { one: "Sticker enviado: {count} persona recibió {each}.", other: "Sticker enviado: {count} personas recibieron {each} cada una." },
    redeemed: "¡Canjeado! Está {state}. Te avisaremos por mensaje cada vez que avance.",
    redeemedPlain: "¡Canjeado! Te avisaremos por mensaje cada vez que avance.",
    redemptionDone: "Listo: el canje ahora está {state}.",
    submissionDone: "Listo: el envío ahora está {state}.",
    done: "Listo.",
    teammate: "alguien del equipo",
  },
);
