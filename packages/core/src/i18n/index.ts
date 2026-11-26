// @propi/core/i18n: Spanish and English for every surface (S2-S4).
//
// How to translate a surface
// --------------------------
// 1. One catalog file per surface, named `<surface>.messages.ts`, next to the code that renders it:
//      apps/web/src/i18n/landing.messages.ts, apps/web/src/i18n/admin-settings.messages.ts,
//      packages/slack/src/i18n/gifts.messages.ts, apps/server/src/i18n/emails.messages.ts …
//    Each writer owns its files; there is no shared registry to edit. A catalog file imports only
//    from "@propi/core/i18n" (no "@/…" aliases, no React), so the repo-wide parity test can load it.
// 2. Export catalogs built with defineMessages(en, es). Keys are flat, dotted by section:
//
//      export const profile = defineMessages(
//        { "language.title": "Language", "saved": "Saved {name}.", "props": { one: "{count} prop", other: "{count} props" } },
//        { "language.title": "Idioma", "saved": "Guardamos {name}.", "props": { one: "{count} reconocimiento", other: "{count} reconocimientos" } },
//      );
//
//    es must have exactly en's keys (compile error otherwise), the same plural shape and the same
//    {placeholders} (thrown when the module loads, and by apps/server/test/i18n.catalogs.test.ts).
// 3. Translate with the locale of the reader:
//      const t = profile.t(locale);   t("saved", { name: "Ana" });   t("props", { count: 3 })
//    Numbers in params are formatted for the locale; use formatNumber / formatDate for the rest.
// 4. Pick the locale with the resolvers: web pages and actions call getLocale() (apps/web/src/i18n/
//    locale.ts); Slack and the server call memberLocale / workspaceLocale (@propi/app), channel posts
//    use the workspace default.
// Spanish is neutral Latin American Spanish with tú. Workspace data (the currency's names, values,
// rewards) is never translated.
export * from "./locale.ts";
export * from "./catalog.ts";
