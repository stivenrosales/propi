// i18n S2: every `*.messages.ts` catalog in the repo has the same keys, plural shapes and placeholders
// in es as in en. Found by file name, so new surfaces are covered without editing this test.
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { checkParity, type Messages } from "@propi/core/i18n";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SKIP = new Set(["node_modules", "dist", ".next", ".git", "data"]);

function catalogFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : catalogFiles(join(dir, e.name));
    return e.name.endsWith(".messages.ts") ? [join(dir, e.name)] : [];
  });
}

const isCatalog = (v: unknown): v is { en: Messages; es: Messages } =>
  typeof v === "object" && v !== null && "en" in v && "es" in v && typeof (v as { t?: unknown }).t === "function";

const files = catalogFiles(join(ROOT, "packages")).concat(catalogFiles(join(ROOT, "apps")));

describe("S2 every message catalog has a complete Spanish version", () => {
  test("catalog files exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files.map((f) => [relative(ROOT, f), f]))("%s", async (_name, file) => {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    const catalogs = Object.entries(mod).filter(([, v]) => isCatalog(v));
    expect(catalogs.length).toBeGreaterThan(0);
    for (const [name, c] of catalogs) expect({ name, problems: checkParity(c as { en: Messages; es: Messages }) }).toEqual({ name, problems: [] });
  });
});
