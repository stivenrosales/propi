// S3 (launch polish): the landing presents the hosted Propi as the main path, has a way into the app,
// and a Pricing section whose numbers come from the site constants.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { site } from "../src/content/site.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), "utf8");

describe("landing", () => {
  test("site exposes the sign-in and app entry points and the plan facts", () => {
    expect(site.signInHref).toBe("/signin");
    expect(site.appHref).toBe("/app");
    expect(site.pricing.freeActiveMembers).toBe(10);
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
    for (const ref of ["site.pricing.freeActiveMembers", "site.pricing.proPerActiveMemberUsd", "site.pricing.billedBy", "site.installHref", "#self-host", "AGPL-3.0"]) {
      expect(pricing, ref).toContain(ref);
    }
    expect(pricing).toContain('id="pricing"');
  });

  test("the landing page renders pricing before the FAQ", () => {
    const page = read("app/(marketing)/page.tsx");
    expect(page.indexOf("<Pricing />")).toBeGreaterThan(-1);
    expect(page.indexOf("<Pricing />")).toBeLessThan(page.indexOf("<Faq />"));
  });

  test("the pricing facts match the existing FAQ and why-propi copy", () => {
    const faq = read("components/marketing/faq.tsx");
    expect(faq).toContain(`up to ${site.pricing.freeActiveMembers} active members`);
    expect(faq).toContain(`$${site.pricing.proPerActiveMemberUsd} per active member per month`);
    const why = read("components/marketing/why-propi.tsx");
    expect(why).toContain("deactivated members never count");
  });
});
