// i18n S2: typed message catalogs. A catalog pairs an English dictionary with a Spanish one that must
// have exactly the same keys, plural shapes and placeholders: TypeScript refuses a missing or extra key
// and defineMessages throws when the module loads, so a gap fails typecheck and tests and never
// renders a raw key. Dependency-free (Intl only), so web, Slack and the server share it.
import { intlTag, type Locale } from "./locale.ts";

/** A message whose wording depends on `{count}` (Intl.PluralRules: "one" or "other"). */
export interface Plural {
  readonly one: string;
  readonly other: string;
}
export type Message = string | Plural;
export type Messages = { readonly [key: string]: Message };

/** The Spanish side: the same keys as English, each a string or a plural as in English. */
export type Mirror<E extends Messages> = { readonly [K in keyof E]: E[K] extends string ? string : Plural };

type Placeholders<S> = S extends `${string}{${infer P}}${infer R}` ? P | Placeholders<R> : never;

/** Interpolated values. Numbers are formatted as quantities for the locale; pass strings for years or ids. */
export type Param = string | number;

type ParamsOf<M> = M extends Plural
  ? { readonly count: number } & { readonly [P in Exclude<Placeholders<M["one"]> | Placeholders<M["other"]>, "count">]: Param }
  : { readonly [P in Placeholders<M>]: Param };

type Args<M> = M extends Plural ? [params: ParamsOf<M>] : [Placeholders<M>] extends [never] ? [] : [params: ParamsOf<M>];

export interface Translator<E extends Messages> {
  <K extends keyof E & string>(key: K, ...args: Args<E[K]>): string;
  readonly locale: Locale;
}

export interface Catalog<E extends Messages> {
  readonly en: E;
  readonly es: Mirror<E>;
  /** The translator for one locale: `catalog.t(locale)("key", { name })`. */
  t(locale: Locale): Translator<E>;
}

const isPlural = (m: Message | undefined): m is Plural => typeof m === "object" && m !== null;
const placeholdersOf = (m: Message): string[] =>
  [...new Set((isPlural(m) ? [m.one, m.other] : [m]).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]!)))].sort();

/** Every way `es` differs from `en` (missing or extra keys, plural shape, placeholders); [] when none. */
export function checkParity(catalog: { readonly en: Messages; readonly es: Messages }): string[] {
  const problems: string[] = [];
  const { en, es } = catalog;
  for (const key of Object.keys(en)) {
    const a = en[key]!;
    const b = es[key];
    if (b === undefined) {
      problems.push(`missing key "${key}" in es`);
      continue;
    }
    if (isPlural(a) !== isPlural(b)) {
      problems.push(`key "${key}" is ${isPlural(a) ? "a plural" : "plain"} in en but not in es`);
      continue;
    }
    const pa = placeholdersOf(a).join(",");
    const pb = placeholdersOf(b).join(",");
    if (pa !== pb) problems.push(`key "${key}" placeholders differ: en {${pa}} vs es {${pb}}`);
  }
  for (const key of Object.keys(es)) if (!(key in en)) problems.push(`extra key "${key}" in es`);
  return problems;
}

const pluralRules = new Map<Locale, Intl.PluralRules>();
const numberFormats = new Map<Locale, Intl.NumberFormat>();

/** A number formatted for the locale (en-US, es-419). */
export function formatNumber(locale: Locale, n: number, options?: Intl.NumberFormatOptions): string {
  if (options !== undefined) return new Intl.NumberFormat(intlTag(locale), options).format(n);
  let f = numberFormats.get(locale);
  if (f === undefined) numberFormats.set(locale, (f = new Intl.NumberFormat(intlTag(locale))));
  return f.format(n);
}

/** A date formatted for the locale; pass `timeZone` (the workspace's) in options. */
export function formatDate(locale: Locale, date: number | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(intlTag(locale), options).format(date);
}

function render(locale: Locale, template: string, params: Readonly<Record<string, Param>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : typeof v === "number" ? formatNumber(locale, v) : v;
  });
}

function translator<E extends Messages>(dict: Messages, locale: Locale): Translator<E> {
  const t = (key: string, params: Readonly<Record<string, Param>> = {}): string => {
    const m = dict[key];
    if (m === undefined) throw new Error(`i18n: unknown message "${key}"`);
    if (!isPlural(m)) return render(locale, m, params);
    let rules = pluralRules.get(locale);
    if (rules === undefined) pluralRules.set(locale, (rules = new Intl.PluralRules(intlTag(locale))));
    const count = Number(params["count"] ?? 0);
    return render(locale, rules.select(count) === "one" ? m.one : m.other, params);
  };
  return Object.assign(t, { locale }) as unknown as Translator<E>;
}

/**
 * Defines one surface's messages. `en` is the source of truth (its literal strings type the
 * placeholders); `es` must mirror it exactly. Throws when the module loads if they differ.
 */
export function defineMessages<const E extends Messages>(en: E, es: Mirror<NoInfer<E>>): Catalog<E> {
  const problems = checkParity({ en, es: es as Messages });
  if (problems.length > 0) throw new Error(`i18n: ${problems.join("; ")}`);
  const byLocale = { en: translator<E>(en, "en"), es: translator<E>(es as Messages, "es") };
  return { en, es, t: (locale) => byLocale[locale] };
}
