// S10: propihq.com serves /privacy and /terms, linked from the site footer and the sign-in page.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { site } from "../src/content/site.ts";

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

  test("pages state the S10 facts", () => {
    const privacy = read("app/(marketing)/privacy/page.tsx");
    for (const fact of ["Polar", "Stripe", "Resend", "PostHog", "OVH", "Cloudflare", "CSV", "2026-11-25"]) {
      expect(privacy, fact).toContain(fact);
    }
    const terms = read("app/(marketing)/terms/page.tsx");
    for (const fact of ["AGPL-3.0", "Peru", "10 active members", "$2"]) {
      expect(terms, fact).toContain(fact);
    }
  });
});
