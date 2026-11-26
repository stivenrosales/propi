// i18n S2-S4: locales, the automatic default (S3) and the typed message catalogs every surface uses.
import { describe, expect, test } from "vitest";
import {
  checkParity,
  defineMessages,
  formatDate,
  formatNumber,
  localeFromAcceptLanguage,
  localeFromTag,
  parseLanguageChoice,
  resolveMemberLocale,
  resolveSignedOutLocale,
  type Messages,
} from "../src/i18n/index.ts";

describe("S3 locale from a language tag", () => {
  test("any Spanish variant is es, any English variant is en, others are unknown", () => {
    expect(localeFromTag("es-PE")).toBe("es");
    expect(localeFromTag("es-419")).toBe("es");
    expect(localeFromTag("es_LA")).toBe("es");
    expect(localeFromTag("ES")).toBe("es");
    expect(localeFromTag("en-US")).toBe("en");
    expect(localeFromTag("en_GB")).toBe("en");
    expect(localeFromTag("fr-FR")).toBeNull();
    expect(localeFromTag("")).toBeNull();
    expect(localeFromTag(null)).toBeNull();
    expect(localeFromTag(undefined)).toBeNull();
  });
});

describe("S3 signed-out pages: cookie, then Accept-Language, then en", () => {
  test("Accept-Language es-PE, es-419 prefer Spanish", () => {
    expect(localeFromAcceptLanguage("es-PE,es;q=0.9,en;q=0.8")).toBe("es");
    expect(localeFromAcceptLanguage("es-419")).toBe("es");
  });

  test("Accept-Language en-US stays English even when Spanish comes later", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,es;q=0.5")).toBe("en");
  });

  test("the highest-weighted supported language wins, whatever the order; unsupported ones are skipped", () => {
    expect(localeFromAcceptLanguage("en;q=0.4, es-MX;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("fr-FR, es;q=0.8, en;q=0.5")).toBe("es");
    expect(localeFromAcceptLanguage("es;q=0, en")).toBe("en");
  });

  test("nothing usable means en", () => {
    expect(localeFromAcceptLanguage("fr-FR,de;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("*")).toBe("en");
    expect(localeFromAcceptLanguage("")).toBe("en");
    expect(localeFromAcceptLanguage(null)).toBe("en");
  });

  test("the propi_locale cookie beats Accept-Language; an invalid cookie is ignored", () => {
    expect(resolveSignedOutLocale({ cookie: "es", acceptLanguage: "en-US" })).toBe("es");
    expect(resolveSignedOutLocale({ cookie: "en", acceptLanguage: "es-PE" })).toBe("en");
    expect(resolveSignedOutLocale({ cookie: "fr", acceptLanguage: "es-PE" })).toBe("es");
    expect(resolveSignedOutLocale({ cookie: undefined, acceptLanguage: null })).toBe("en");
  });
});

describe("S3 signed-in and Slack: member choice, then Slack locale, then workspace default, then en", () => {
  test("the member's own choice beats their Slack locale and the workspace default", () => {
    expect(resolveMemberLocale({ choice: "en", slackLocale: "es-LA", workspaceDefault: "es" })).toBe("en");
    expect(resolveMemberLocale({ choice: "es", slackLocale: "en-US", workspaceDefault: "en" })).toBe("es");
  });

  test("automatic follows the Slack locale before the workspace default", () => {
    expect(resolveMemberLocale({ choice: "auto", slackLocale: "es-LA", workspaceDefault: "en" })).toBe("es");
    expect(resolveMemberLocale({ choice: undefined, slackLocale: "en-US", workspaceDefault: "es" })).toBe("en");
  });

  test("without a usable Slack locale the workspace default applies, else en", () => {
    expect(resolveMemberLocale({ choice: "auto", slackLocale: "fr-FR", workspaceDefault: "es" })).toBe("es");
    expect(resolveMemberLocale({ choice: undefined, slackLocale: null, workspaceDefault: "es" })).toBe("es");
    expect(resolveMemberLocale({ choice: undefined, slackLocale: undefined, workspaceDefault: undefined })).toBe("en");
  });

  test("a language choice is auto, en or es; anything else is refused", () => {
    expect(parseLanguageChoice("auto")).toBe("auto");
    expect(parseLanguageChoice("es")).toBe("es");
    expect(parseLanguageChoice(" en ")).toBe("en");
    expect(parseLanguageChoice("fr")).toBeNull();
    expect(parseLanguageChoice(null)).toBeNull();
  });
});

const demo = defineMessages(
  {
    hello: "Hi {name}!",
    plain: "Settings",
    props: { one: "{count} prop from {giver}", other: "{count} props from {giver}" },
  },
  {
    hello: "¡Hola, {name}!",
    plain: "Ajustes",
    props: { one: "{count} reconocimiento de {giver}", other: "{count} reconocimientos de {giver}" },
  },
);

describe("S2 message catalogs", () => {
  test("a translator interpolates parameters in the chosen locale", () => {
    expect(demo.t("en")("hello", { name: "Ana" })).toBe("Hi Ana!");
    expect(demo.t("es")("hello", { name: "Ana" })).toBe("¡Hola, Ana!");
    expect(demo.t("es")("plain")).toBe("Ajustes");
    expect(demo.t("es").locale).toBe("es");
    // @ts-expect-error: "hello" needs {name}; placeholders are typed from the English string.
    expect(demo.t("en")("hello")).toBe("Hi {name}!");
    // @ts-expect-error: unknown keys do not compile.
    expect(() => demo.t("en")("nope")).toThrow(/unknown message/);
  });

  test("plural messages pick one/other by locale and format the count", () => {
    const en = demo.t("en");
    const es = demo.t("es");
    expect(en("props", { count: 1, giver: "Bo" })).toBe("1 prop from Bo");
    expect(en("props", { count: 1200, giver: "Bo" })).toBe("1,200 props from Bo");
    expect(es("props", { count: 1, giver: "Bo" })).toBe("1 reconocimiento de Bo");
    expect(es("props", { count: 3, giver: "Bo" })).toBe("3 reconocimientos de Bo");
  });

  test("an es dictionary missing a key fails at compile time and at runtime", () => {
    expect(() =>
      // @ts-expect-error: es must have exactly the keys of en.
      defineMessages({ a: "A", b: "B" }, { a: "A" }),
    ).toThrow(/missing key "b"/);
  });

  test("an extra key, a plural/plain mismatch or a different placeholder fails at runtime", () => {
    expect(() =>
      // @ts-expect-error: no keys beyond en's.
      defineMessages({ a: "A" }, { a: "A", z: "Z" }),
    ).toThrow(/extra key "z"/);
    expect(() =>
      // @ts-expect-error: a plural must stay a plural.
      defineMessages({ a: { one: "{count} a", other: "{count} as" } }, { a: "unas" }),
    ).toThrow(/"a"/);
    expect(() => defineMessages({ a: "Hi {name}" }, { a: "Hola {nombre}" })).toThrow(/placeholder/);
  });

  test("checkParity reports nothing for a consistent catalog", () => {
    expect(checkParity(demo as unknown as { en: Messages; es: Messages })).toEqual([]);
  });

  test("numbers and dates use the language's formatting", () => {
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    // Neutral Latin American Spanish (es-419): comma grouping, point decimals, like Peru and Mexico.
    expect(formatNumber("es", 1234567.5)).toBe("1,234,567.5");
    const d = Date.UTC(2026, 10, 25, 15, 0, 0);
    expect(formatDate("en", d, { dateStyle: "long", timeZone: "America/Lima" })).toBe("November 25, 2026");
    expect(formatDate("es", d, { dateStyle: "long", timeZone: "America/Lima" })).toBe("25 de noviembre de 2026");
  });
});
