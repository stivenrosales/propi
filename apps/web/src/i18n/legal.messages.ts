// i18n S1, S5: the /privacy and /terms pages. `{mail}`, `{privacy}`, `{license}` and `{github}` stand
// for links and `{from}`, `{name}`, `{polar}`-style names for bold words; the pages render them with rich().
import { defineMessages } from "@propi/core/i18n";

/** The frame both pages share. */
export const legal = defineMessages(
  { eyebrow: "Legal", effective: "Effective {date}" },
  { eyebrow: "Legal", effective: "Vigente desde el {date}" },
);

export const privacy = defineMessages(
  {
    "meta.title": "Privacy Policy",
    "meta.description": "What the hosted Propi collects from Slack and from your team's use, why, who processes it, and how to export or delete it.",
    title: "Privacy Policy",
    intro:
      "This policy explains what the hosted Propi at propihq.com collects, why, and what you can do about it. We keep it short and in plain language. It is a plain-language template, not legal advice. If you self-host Propi, your data never reaches us and this policy does not apply to your installation.",
    "who.title": "Who we are",
    "who.body": "The hosted Propi is operated by Stiven Rosales, an individual based in Peru. You can reach us at {mail}.",
    "collect.title": "What we collect",
    "collect.slack": "{from}, when your workspace installs Propi or a member signs in, we store each member's:",
    "collect.slack.from": "From Slack",
    "collect.field.id": "Slack user id",
    "collect.field.name": "name",
    "collect.field.email": "email",
    "collect.field.avatar": "avatar",
    "collect.field.timezone": "timezone",
    "collect.use": "{from}, we store the recognition data your team creates: gifts, the ledger of balances, and redemptions, plus your workspace settings.",
    "collect.use.from": "From using Propi",
    "why.title": "Why we use it",
    "why.body":
      "We use this data only to run Propi for your workspace: to show who gave props to whom, keep balances correct, process redemptions in your shop, apply your settings, send the emails the service needs, and understand how the product is used so we can improve it. We do not sell your data.",
    "payments.title": "Payments",
    "payments.body":
      "Paid plans are sold through Polar, which acts as the merchant of record and handles checkout, invoices and taxes. Card payments are processed by Stripe on Polar's behalf. We never see or store your card number.",
    "sub.title": "Subprocessors",
    "sub.intro": "These services process data for us so Propi can run:",
    "sub.slack": "sign-in, member profiles and messages inside your workspace",
    "sub.polar": "{polar} (with {stripe}): payments and billing",
    "sub.resend": "email delivery",
    "sub.posthog": "product analytics",
    "sub.ovh": "{ovh} (VPS): hosting of the app and its database",
    "sub.cloudflare": "DNS",
    "retention.title": "How long we keep it",
    "retention.body":
      "Your data stays in Propi while your workspace uses it. Uninstalling Propi from Slack does not delete it: we keep it until a workspace admin asks us to delete it at {mail}. You can export your data as CSV at any time from the admin dashboard.",
    "rights.title": "Your rights",
    "rights.body": "You can ask us to access, correct, export or delete the data we hold about you or your workspace. Write to {mail} and we will answer.",
    "changes.title": "Changes",
    "changes.body": "If we change this policy, we will update it on this page and change the effective date above.",
  },
  {
    "meta.title": "Política de privacidad",
    "meta.description": "Qué datos recoge Propi en la nube desde Slack y del uso de tu equipo, para qué, quién los procesa y cómo exportarlos o borrarlos.",
    title: "Política de privacidad",
    intro:
      "Esta política explica qué datos recoge Propi en la nube, en propihq.com, para qué y qué puedes hacer al respecto. La mantenemos corta y en lenguaje sencillo. Es una plantilla en lenguaje sencillo, no asesoría legal. Si alojas Propi por tu cuenta, tus datos nunca nos llegan y esta política no aplica a tu instalación.",
    "who.title": "Quiénes somos",
    "who.body": "Propi en la nube lo opera Stiven Rosales, una persona natural con sede en Perú. Puedes escribirnos a {mail}.",
    "collect.title": "Qué recogemos",
    "collect.slack": "{from}, cuando tu espacio de trabajo instala Propi o un miembro inicia sesión, guardamos de cada miembro su:",
    "collect.slack.from": "Desde Slack",
    "collect.field.id": "id de usuario de Slack",
    "collect.field.name": "nombre",
    "collect.field.email": "email",
    "collect.field.avatar": "avatar",
    "collect.field.timezone": "zona horaria",
    "collect.use":
      "{from}, guardamos los datos de reconocimiento que crea tu equipo: regalos, el registro de saldos y los canjes, además de la configuración de tu espacio de trabajo.",
    "collect.use.from": "Al usar Propi",
    "why.title": "Para qué los usamos",
    "why.body":
      "Usamos estos datos solo para operar Propi en tu espacio de trabajo: mostrar quién reconoció a quién, mantener los saldos correctos, procesar los canjes de tu tienda, aplicar tu configuración, enviar los emails que el servicio necesita y entender cómo se usa el producto para mejorarlo. No vendemos tus datos.",
    "payments.title": "Pagos",
    "payments.body":
      "Los planes de pago se venden a través de Polar, que actúa como comerciante registrado y se encarga del pago, las facturas y los impuestos. Stripe procesa los pagos con tarjeta en nombre de Polar. Nunca vemos ni guardamos el número de tu tarjeta.",
    "sub.title": "Subencargados",
    "sub.intro": "Estos servicios procesan datos por nosotros para que Propi funcione:",
    "sub.slack": "inicio de sesión, perfiles de los miembros y mensajes dentro de tu espacio de trabajo",
    "sub.polar": "{polar} (con {stripe}): pagos y facturación",
    "sub.resend": "envío de emails",
    "sub.posthog": "analítica del producto",
    "sub.ovh": "{ovh} (VPS): alojamiento de la app y su base de datos",
    "sub.cloudflare": "DNS",
    "retention.title": "Cuánto tiempo los guardamos",
    "retention.body":
      "Tus datos se quedan en Propi mientras tu espacio de trabajo lo use. Desinstalar Propi de Slack no los borra: los guardamos hasta que un admin del espacio de trabajo nos pida borrarlos en {mail}. Puedes exportar tus datos en CSV cuando quieras desde el panel de administración.",
    "rights.title": "Tus derechos",
    "rights.body": "Puedes pedirnos acceder, corregir, exportar o borrar los datos que tenemos sobre ti o tu espacio de trabajo. Escríbenos a {mail} y te responderemos.",
    "changes.title": "Cambios",
    "changes.body": "Si cambiamos esta política, la actualizaremos en esta página y cambiaremos la fecha de vigencia de arriba.",
  },
);

export const terms = defineMessages(
  {
    "meta.title": "Terms of Service",
    "meta.description": "The terms for using the hosted Propi: plans and billing, acceptable use, availability, termination and liability.",
    title: "Terms of Service",
    intro:
      "These terms apply when your team uses the hosted Propi at propihq.com. By installing Propi in your Slack workspace or signing in, you agree to them. They are a plain-language template, not legal advice.",
    "service.title": "The service",
    "service.body":
      "Propi is peer recognition for Slack: members give props, balances are kept in a ledger, and props can be redeemed in your team's shop. The hosted Propi is operated by Stiven Rosales, an individual based in Peru. How we handle data is described in our {privacy}.",
    "privacyLink": "Privacy Policy",
    "plans.title": "Plans and billing",
    "plans.free.name": "Free",
    "plans.free": "{name}: up to {free} active members per workspace.",
    "plans.pro.name": "Pro",
    "plans.pro":
      "{name}: ${price} per active member per month, billed by Polar, our merchant of record. Seats follow your active members, so the number you pay for changes as members join or are deactivated.",
    "plans.polar": "Polar handles checkout, invoices, taxes and cancellations under its own terms.",
    "use.title": "Acceptable use",
    "use.body":
      "Use Propi for recognition inside your team. Do not use it to harass people, send spam, break the law, or try to disrupt, overload or get unauthorized access to the service or other workspaces. Workspace admins are responsible for how their workspace uses Propi.",
    "open.title": "Open source",
    "open.body":
      "Propi is open source under the {license} license. If you prefer to run it yourself, you can self-host it from {github} instead of using the hosted service. These terms cover only the hosted service.",
    "open.github": "the GitHub repository",
    "availability.title": "Availability and no warranty",
    "availability.body":
      "We work to keep Propi running and your data safe, but the service is provided \"as is\" and \"as available\", without warranties of any kind. It may change, pause for maintenance, or have interruptions.",
    "termination.title": "Termination",
    "termination.body":
      "You can stop using Propi at any time by uninstalling it from Slack and cancelling any paid plan. We may suspend or end access for a workspace that breaks these terms. After uninstalling, you can ask us to delete your data as described in the {privacy}.",
    "liability.title": "Limitation of liability",
    "liability.body":
      "To the extent the law allows, we are not liable for indirect or consequential damages, and our total liability for any claim is limited to the amount your workspace paid for Propi in the 12 months before the claim.",
    "law.title": "Governing law",
    "law.body": "These terms are governed by the laws of Peru.",
    "changes.title": "Changes and contact",
    "changes.body": "If we change these terms, we will update them on this page and change the effective date above. Questions? Write to {mail}.",
  },
  {
    "meta.title": "Términos del servicio",
    "meta.description": "Los términos para usar Propi en la nube: planes y facturación, uso aceptable, disponibilidad, terminación y responsabilidad.",
    title: "Términos del servicio",
    intro:
      "Estos términos aplican cuando tu equipo usa Propi en la nube, en propihq.com. Al instalar Propi en tu espacio de trabajo de Slack o al iniciar sesión, los aceptas. Son una plantilla en lenguaje sencillo, no asesoría legal.",
    "service.title": "El servicio",
    "service.body":
      "Propi es reconocimiento entre compañeros para Slack: los miembros se dan reconocimientos, los saldos se llevan en un registro y los reconocimientos se pueden canjear en la tienda de tu equipo. Propi en la nube lo opera Stiven Rosales, una persona natural con sede en Perú. Cómo tratamos los datos se describe en nuestra {privacy}.",
    "privacyLink": "Política de privacidad",
    "plans.title": "Planes y facturación",
    "plans.free.name": "Gratis",
    "plans.free": "{name}: hasta {free} miembros activos por espacio de trabajo.",
    "plans.pro.name": "Pro",
    "plans.pro":
      "{name}: US${price} por miembro activo al mes, facturado por Polar, nuestro comerciante registrado. Los puestos siguen a tus miembros activos, así que la cantidad que pagas cambia cuando se suman miembros o se desactivan.",
    "plans.polar": "Polar se encarga del pago, las facturas, los impuestos y las cancelaciones según sus propios términos.",
    "use.title": "Uso aceptable",
    "use.body":
      "Usa Propi para reconocer a tu equipo. No lo uses para acosar a nadie, enviar spam, infringir la ley ni para intentar interrumpir, sobrecargar u obtener acceso no autorizado al servicio o a otros espacios de trabajo. Los admins de cada espacio de trabajo son responsables de cómo se usa Propi en él.",
    "open.title": "Código abierto",
    "open.body":
      "Propi es de código abierto con la licencia {license}. Si prefieres ejecutarlo tú, puedes alojarlo por tu cuenta desde {github} en lugar de usar el servicio en la nube. Estos términos cubren solo el servicio en la nube.",
    "open.github": "el repositorio de GitHub",
    "availability.title": "Disponibilidad y sin garantía",
    "availability.body":
      "Trabajamos para que Propi siga funcionando y tus datos estén seguros, pero el servicio se ofrece \"tal cual\" y \"según disponibilidad\", sin garantías de ningún tipo. Puede cambiar, pausarse por mantenimiento o tener interrupciones.",
    "termination.title": "Terminación",
    "termination.body":
      "Puedes dejar de usar Propi cuando quieras desinstalándolo de Slack y cancelando cualquier plan de pago. Podemos suspender o terminar el acceso de un espacio de trabajo que incumpla estos términos. Después de desinstalar, puedes pedirnos que borremos tus datos como se describe en la {privacy}.",
    "liability.title": "Limitación de responsabilidad",
    "liability.body":
      "En la medida en que la ley lo permita, no respondemos por daños indirectos o consecuentes, y nuestra responsabilidad total por cualquier reclamo se limita a lo que tu espacio de trabajo pagó por Propi en los 12 meses anteriores al reclamo.",
    "law.title": "Ley aplicable",
    "law.body": "Estos términos se rigen por las leyes del Perú.",
    "changes.title": "Cambios y contacto",
    "changes.body": "Si cambiamos estos términos, los actualizaremos en esta página y cambiaremos la fecha de vigencia de arriba. ¿Preguntas? Escríbenos a {mail}.",
  },
);
