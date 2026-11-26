// S10: propihq.com serves /privacy and /terms, linked from the site footer and the sign-in page.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { site } from "../src/content/site.ts";
import { legal, privacy, terms } from "../src/i18n/legal.messages.ts";

const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
const read = (path: string) => readFileSync(src(path), "utf8");

describe("legal pages", () => {
  test("site content exposes the legal links and contact email", () => {
    expect(site.privacy).toBe("/privacy");
    expect(site.terms).toBe("/terms");
    expect(site.contactEmail).toBe("hola@propihq.com");
  });

  test("both routes exist in the marketing group", () => {
    expect(existsSync(src("app/(marketing)/privacy/page.tsx"))).toBe(true);
    expect(existsSync(src("app/(marketing)/terms/page.tsx"))).toBe(true);
  });

  test("the footer and the sign-in page link to both pages", () => {
    for (const file of ["components/marketing/site-footer.tsx", "app/signin/page.tsx"]) {
      const code = read(file);
      expect(code, file).toContain("site.privacy");
      expect(code, file).toContain("site.terms");
    }
  });

  test("pages state the S10 facts in English and Spanish", () => {
    const privacyPage = read("app/(marketing)/privacy/page.tsx");
    for (const fact of ["Polar", "Stripe", "Resend", "PostHog", "OVH", "Cloudflare", "2026-11-25"]) {
      expect(privacyPage, fact).toContain(fact);
    }
    for (const locale of ["en", "es"] as const) {
      const p = privacy.t(locale);
      expect(p("payments.body"), locale).toContain("Polar");
      expect(p("payments.body"), locale).toContain("Stripe");
      expect(p("retention.body", { mail: site.contactEmail }), locale).toContain("CSV");
      expect(p("retention.body", { mail: site.contactEmail }), locale).toContain(site.contactEmail);
    }
    const termsPage = read("app/(marketing)/terms/page.tsx");
    for (const fact of ["AGPL-3.0", "site.pricing.freeActiveMembers", "site.pricing.proPerActiveMemberUsd"]) {
      expect(termsPage, fact).toContain(fact);
    }
    const plan = { name: "Pro", price: site.pricing.proPerActiveMemberUsd };
    expect(terms.t("en")("law.body")).toContain("Peru");
    expect(terms.t("es")("law.body")).toContain("Perú");
    expect(terms.t("en")("plans.pro", plan)).toContain("$2 per active member per month");
    expect(terms.t("es")("plans.pro", plan)).toContain("US$2 por miembro activo al mes");
    expect(terms.t("en")("plans.free", { name: "Free", free: site.pricing.freeActiveMembers })).toContain("up to 5 active members");
    expect(terms.t("es")("plans.free", { name: "Gratis", free: site.pricing.freeActiveMembers })).toContain("hasta 5 miembros activos");
  });

  test("i18n S5: titles and descriptions follow the language on the same URLs", () => {
    for (const [file, canonical] of [["app/(marketing)/privacy/page.tsx", "site.privacy"], ["app/(marketing)/terms/page.tsx", "site.terms"]] as const) {
      const code = read(file);
      expect(code, file).toContain("generateMetadata");
      expect(code, file).toContain(`canonical: ${canonical}`);
    }
    expect(privacy.t("es")("meta.title")).toBe("Política de privacidad");
    expect(terms.t("es")("meta.title")).toBe("Términos del servicio");
    expect(legal.t("es")("effective", { date: "25 de noviembre de 2026" })).toBe("Vigente desde el 25 de noviembre de 2026");
  });
});
