// i18n S4a-S4c: the ES | EN switcher, the admin Settings "Language" card and the Profile language card.
import { defineMessages } from "@propi/core/i18n";

export const language = defineMessages(
  {
    "switcher.label": "Language",
    "settings.title": "Language",
    "settings.field": "Default language",
    "settings.hint": "Members on Automatic see Propi in their Slack language, or in this one when Slack doesn't say. Channel posts always use it.",
    "settings.save": "Save language",
    "settings.saved": "Workspace language saved.",
    "profile.title": "Language",
    "profile.field": "Show Propi in",
    "profile.auto": "Automatic",
    "profile.hint": "For this site and for Propi's messages to you in Slack. Automatic follows your Slack language, then the workspace default.",
    "profile.save": "Save language",
    "profile.saved": "Language saved.",
    "error.invalid": "Pick a language from the list.",
  },
  {
    "switcher.label": "Idioma",
    "settings.title": "Idioma",
    "settings.field": "Idioma predeterminado",
    "settings.hint": "Quienes usan Automático ven Propi en el idioma de su Slack, o en este si Slack no lo indica. Las publicaciones en canales siempre lo usan.",
    "settings.save": "Guardar idioma",
    "settings.saved": "Guardamos el idioma del espacio de trabajo.",
    "profile.title": "Idioma",
    "profile.field": "Ver Propi en",
    "profile.auto": "Automático",
    "profile.hint": "Para este sitio y para los mensajes que Propi te envía en Slack. Automático sigue el idioma de tu Slack y, si no, el del espacio de trabajo.",
    "profile.save": "Guardar idioma",
    "profile.saved": "Guardamos tu idioma.",
    "error.invalid": "Elige un idioma de la lista.",
  },
);

/** Each language named in itself, as language pickers show them. */
export const LANGUAGE_NAMES = { es: "Español", en: "English" } as const;
