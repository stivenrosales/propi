// i18n S2, S3: the supported locales and how the language is picked automatically. Pure: callers pass
// what the request carries (cookie, Accept-Language, member choice, Slack locale, workspace default).

/** S2: the languages Propi speaks. */
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** S4c: what a member picks in Profile. "auto" follows their Slack locale, then the workspace default. */
export type LanguageChoice = "auto" | Locale;

/** The cookie the ES | EN switcher sets on signed-out pages (S4a). */
export const LOCALE_COOKIE = "propi_locale";

export const isLocale = (v: unknown): v is Locale => v === "en" || v === "es";

/** The BCP 47 tag Intl formats with: neutral Latin American Spanish for es. */
export const intlTag = (locale: Locale): string => (locale === "es" ? "es-419" : "en-US");

/** "es-PE", "es_LA", "es-419" → es; "en-US" → en; anything else (or nothing) → null. */
export function localeFromTag(tag: string | null | undefined): Locale | null {
  if (tag === null || tag === undefined) return null;
  const lang = tag.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(lang) ? lang : null;
}

/** A form value for the member's language: "auto", "en" or "es"; null when it is anything else. */
export function parseLanguageChoice(v: unknown): LanguageChoice | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "auto" || isLocale(t) ? t : null;
}

/** S3: the supported language the browser weights highest (q-values, then order); en when none. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (header === null || header === undefined) return DEFAULT_LOCALE;
  let best: { locale: Locale; q: number; at: number } | null = null;
  for (const [at, part] of header.split(",").entries()) {
    const [tag = "", ...params] = part.trim().split(";");
    const locale = localeFromTag(tag);
    if (locale === null) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith("q="));
    const q = qParam === undefined ? 1 : Number(qParam.slice(2));
    if (!Number.isFinite(q) || q <= 0) continue;
    if (best === null || q > best.q || (q === best.q && at < best.at)) best = { locale, q, at };
  }
  return best?.locale ?? DEFAULT_LOCALE;
}

/** S3 signed-out pages: the switcher's cookie, then Accept-Language, then en. */
export function resolveSignedOutLocale(input: { readonly cookie: string | null | undefined; readonly acceptLanguage: string | null | undefined }): Locale {
  return isLocale(input.cookie) ? input.cookie : localeFromAcceptLanguage(input.acceptLanguage);
}

/**
 * S3 signed-in web pages and Slack: the member's own choice → their Slack locale (users.info
 * `locale`) → the workspace default language → en.
 */
export function resolveMemberLocale(input: {
  readonly choice: LanguageChoice | null | undefined;
  readonly slackLocale: string | null | undefined;
  readonly workspaceDefault: Locale | null | undefined;
}): Locale {
  if (isLocale(input.choice)) return input.choice;
  return localeFromTag(input.slackLocale) ?? input.workspaceDefault ?? DEFAULT_LOCALE;
}

/** S3 channel posts: the workspace default language, en when none is set. */
export const resolveWorkspaceLocale = (workspaceDefault: Locale | null | undefined): Locale => workspaceDefault ?? DEFAULT_LOCALE;
