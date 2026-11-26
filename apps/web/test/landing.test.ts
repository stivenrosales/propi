// S3 (launch polish): the landing presents the hosted Propi as the main path, has a way into the app,
// and a Pricing section whose numbers come from the site constants.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { site } from "../src/content/site.ts";
import { landing } from "../src/i18n/landing.messages.ts";
import { SIGNIN_ERRORS, signin } from "../src/i18n/signin.messages.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), "utf8");

describe("landing", () => {
  test("site exposes the sign-in and app entry points and the plan facts", () => {
    expect(site.signInHref).toBe("/signin");
    expect(site.appHref).toBe("/app");
    expect(site.pricing.freeActiveMembers).toBe(5);
    expect(site.pricing.proPerActiveMemberUsd).toBe(2);
    expect(site.pricing.billedBy).toBe("Polar");
  });

  test("the header links to sign in, the app and pricing", () => {
    const header = read("components/marketing/site-header.tsx");
    expect(header).toContain("site.signInHref");
    expect(header).toContain("site.appHref");
    expect(header).toContain("#pricing");
  });

  test("the hero says Propi is hosted and offers sign in", () => {
    const hero = read("components/marketing/hero.tsx");
    expect(hero).toContain("site.hostedDomain");
    expect(hero).toContain("site.signInHref");
    expect(hero).toContain("site.installHref");
  });

  test("the pricing section uses the site constants, offers Add to Slack and points to self-host", () => {
    const pricing = read("components/marketing/pricing.tsx");
    for (const ref of ["site.pricing.freeActiveMembers", "site.pricing.proPerActiveMemberUsd", "site.pricing.billedBy", "site.installHref", "#self-host"]) {
      expect(pricing, ref).toContain(ref);
    }
    for (const locale of ["en", "es"] as const) expect(landing.t(locale)("pricing.selfHostLink"), locale).toContain("AGPL-3.0");
    expect(pricing).toContain('id="pricing"');
  });

  test("the landing page renders pricing before the FAQ", () => {
    const page = read("app/(marketing)/page.tsx");
    expect(page.indexOf("<Pricing />")).toBeGreaterThan(-1);
    expect(page.indexOf("<Pricing />")).toBeLessThan(page.indexOf("<Faq />"));
  });

  test("the FAQ and why-propi take the plan facts from the site constants", () => {
    for (const file of ["components/marketing/faq.tsx", "components/marketing/why-propi.tsx"]) {
      const code = read(file);
      expect(code, file).toContain("site.pricing.freeActiveMembers");
      expect(code, file).toContain("site.pricing.proPerActiveMemberUsd");
    }
  });

  test("the pricing facts match the FAQ and why-propi copy in English and Spanish", () => {
    const facts = { free: site.pricing.freeActiveMembers, price: site.pricing.proPerActiveMemberUsd };
    const en = landing.t("en");
    expect(en("faq.cost.a", facts)).toContain("up to 5 active members");
    expect(en("faq.cost.a", facts)).toContain("$2 per active member per month");
    expect(en("why.pricing.detail", facts)).toContain("deactivated members never count");
    const es = landing.t("es");
    expect(es("faq.cost.a", facts)).toContain("hasta 5 miembros activos");
    expect(es("faq.cost.a", facts)).toContain("US$2 por miembro activo al mes");
    expect(es("why.pricing.detail", facts)).toContain("los miembros desactivados nunca cuentan");
  });
});

describe("i18n S1 landing and sign-in in Spanish", () => {
  test("the hero, pricing and sign-in speak Spanish, with the same plan numbers", () => {
    const es = landing.t("es");
    expect([es("hero.title.1"), es("hero.title.2"), es("hero.title.3")].join(" ")).toBe("Da las gracias. Haz que cuente.");
    expect(es("hero.free", { free: site.pricing.freeActiveMembers })).toBe("gratis hasta 5 miembros activos");
    expect(es("pricing.title")).toBe("Precios simples. Empieza gratis.");
    expect(es("pricing.pro.point2", { billedBy: site.pricing.billedBy })).toBe("Facturado a través de Polar");
    expect(landing.t("en")("hero.title.1")).toBe("Say thanks.");
    expect(signin.t("es")("title")).toBe("Hola de nuevo");
    expect(signin.t("es")("meta.title")).toBe("Iniciar sesión");
  });

  test("every landing component and the sign-in page translate with the request's locale", () => {
    for (const file of [
      "components/marketing/hero.tsx",
      "components/marketing/how-it-works.tsx",
      "components/marketing/features.tsx",
      "components/marketing/why-propi.tsx",
      "components/marketing/pricing.tsx",
      "components/marketing/self-host.tsx",
      "components/marketing/faq.tsx",
      "components/marketing/site-header.tsx",
      "components/marketing/site-footer.tsx",
      "app/signin/page.tsx",
    ]) {
      expect(read(file), file).toMatch(/getLocale\(\)/);
    }
  });

  test("every sign-in error code has a message in both languages", () => {
    const code = read("app/signin/page.tsx");
    expect(code).not.toContain("const ERRORS");
    for (const code of [...SIGNIN_ERRORS, "unknown"] as const) {
      expect(signin.es[`error.${code}`], code).toBeTruthy();
      expect(signin.es[`error.${code}`], code).not.toBe(signin.en[`error.${code}`]);
    }
  });
});
