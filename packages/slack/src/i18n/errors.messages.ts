// i18n S1, S2: why something was refused, and the states a redemption or submission can be in.
// Workspace data ({plural}, amounts) is interpolated, never translated.
import { defineMessages } from "@propi/core/i18n";

export const errors = defineMessages(
  {
    over_allowance:
      "That would cost {cost}, but you have {remaining} left to give today. Mention fewer people or use fewer {plural}; your allowance resets at midnight.",
    channel_not_allowed: "{plural} can't be given in this conversation. Try a public channel.",
    inactive_member: "Your account is deactivated in this workspace.",
    bots_may_not_give: "Bots can't give in this workspace.",
    insufficient_redeemable: "That reward costs {cost} and you have {redeemable} to spend.",
    out_of_stock: "That reward is out of stock.",
    budget_exceeded: "The shop's monthly budget is used up. Try again next month.",
    plan_limit: "Your workspace is over the Free plan limit. Ask an admin to upgrade to Pro.",
    reward_unavailable: "That reward is no longer available.",
    forbidden: "You don't have permission to do that.",
    illegal_transition: "That redemption is already {state}.",
    idempotency_key_reused: "That was already handled.",
    unknown: "That didn't work ({code}).",
  },
  {
    over_allowance:
      "Eso costaría {cost}, pero hoy te quedan {remaining} por dar. Menciona a menos personas o usa menos {plural}; tu cupo se renueva a medianoche.",
    channel_not_allowed: "No se pueden dar {plural} en esta conversación. Prueba en un canal público.",
    inactive_member: "Tu cuenta está desactivada en este espacio de trabajo.",
    bots_may_not_give: "Los bots no pueden dar en este espacio de trabajo.",
    insufficient_redeemable: "Ese premio cuesta {cost} y tienes {redeemable} para canjear.",
    out_of_stock: "Ese premio está agotado.",
    budget_exceeded: "Ya se usó el presupuesto mensual de la tienda. Inténtalo de nuevo el próximo mes.",
    plan_limit: "Tu espacio de trabajo superó el límite del plan Free. Pídele a un admin que pase a Pro.",
    reward_unavailable: "Ese premio ya no está disponible.",
    forbidden: "No tienes permiso para hacer eso.",
    illegal_transition: "Ese canje ya está {state}.",
    idempotency_key_reused: "Eso ya se procesó.",
    unknown: "Eso no funcionó ({code}).",
  },
);

/** A redemption's or submission's state as a word (both nouns are masculine in Spanish: canje, envío). */
export const states = defineMessages(
  { pending: "pending", approved: "approved", fulfilled: "fulfilled", rejected: "rejected", cancelled: "cancelled", updated: "updated", reviewed: "reviewed" },
  { pending: "pendiente", approved: "aprobado", fulfilled: "entregado", rejected: "rechazado", cancelled: "cancelado", updated: "actualizado", reviewed: "revisado" },
);
