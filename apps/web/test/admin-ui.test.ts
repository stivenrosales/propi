// S1 (launch polish): the admin screens share one select style, one number-input style, aligned
// form rows, and the members table shows people, not internal ids.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const read = (path: string) => readFileSync(join(src, path), "utf8");
const adminDir = join(src, "app/(admin)/admin");
const pages = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? pages(p) : f === "page.tsx" ? [p] : [];
  });

describe("admin form controls (S1)", () => {
  const css = read("app/globals.css");
  const ui = read("components/app/ui.tsx");

  test("the Select primitive carries the shared chevron style, which skips multi-selects", () => {
    expect(ui).toMatch(/<select className=\{control\(cx\("select /);
    expect(css).toMatch(/\.select:not\(\[multiple\]\) \{[^}]*appearance: none;[^}]*background-image:[^}]*padding-inline-end: 2\.5rem;/s);
  });

  test("number inputs have no spinner and ask for the numeric keypad", () => {
    expect(css).toMatch(/input\[type="number"\]::-webkit-inner-spin-button/);
    expect(css).toMatch(/input\[type="number"\] \{[^}]*appearance: textfield;/s);
    expect(ui).toMatch(/inputMode=\{p\.type === "number" \? "numeric" : undefined\}/);
  });

  test("Field spans a label row and a control row inside a `fields` grid", () => {
    expect(css).toMatch(/\.fields > \.field \{[^}]*grid-row: span 2;[^}]*grid-template-rows: subgrid;/s);
    expect(ui).toMatch(/cx\("field grid /);
  });

  test("admin pages use the primitives: no raw select, and two-column Field forms are `fields` grids", () => {
    for (const page of pages(adminDir)) {
      const code = readFileSync(page, "utf8");
      expect(code, page).not.toMatch(/<select\b/);
      for (const [, cls] of code.matchAll(/<form [^>]*className="([^"]*grid-cols-2[^"]*)"/g)) {
        expect(cls, page).toMatch(/\bfields\b/);
      }
    }
  });
});

describe("members table (S1)", () => {
  const members = read("app/(admin)/admin/members/page.tsx");

  test("shows no internal member id as text", () => {
    expect(members).not.toMatch(/>\{m\.id\}</);
  });

  test("the current admin's row keeps a locked Active checkbox so the columns line up", () => {
    expect(members).toMatch(/<Checkbox label="Active" checked disabled readOnly/);
  });

  test("status labels do not wrap", () => {
    expect(members).toMatch(/label="Hide from boards"[^>]*className="whitespace-nowrap"/);
  });
});
