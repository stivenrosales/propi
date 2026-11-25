// S106: adapters hold no rules, and the rules hold no adapters. packages/core imports nothing outside
// itself: no node: built-ins, no packages, no relative path that leaves packages/core/src.
// It lives in packages/app/test because core's own test program has no Node types.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const CORE_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../core/src");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

function specifiers(source: string): string[] {
  return [...source.matchAll(IMPORT)].map((mm) => mm[1] ?? mm[2] ?? mm[3] ?? "");
}

/** Browser/Node runtime APIs a pure core must not reach for. */
const FORBIDDEN_GLOBALS = /\b(Date\.now|Math\.random|process\.|require\(|fetch\(|setTimeout\(|setInterval\(|crypto\.(subtle|getRandomValues|randomUUID)|globalThis\.)/;

describe("S106: dependency rule", () => {
  const files = tsFiles(CORE_SRC);

  test("S106: the scan sees the core modules (guards against a vacuous pass)", () => {
    const rel = files.map((f) => relative(CORE_SRC, f));
    expect(rel).toEqual(expect.arrayContaining(["index.ts", "api/index.ts", "identity/index.ts", "ledger/entries.ts"]));
    expect(specifiers('import { a } from "./x.ts";\nexport * from "../y.ts";\nimport "z";\nconst q = await import("w");')).toEqual(["./x.ts", "../y.ts", "z", "w"]);
  });

  test("S106: packages/core imports only its own relative modules", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        const inside = spec.startsWith(".") && !relative(CORE_SRC, resolve(dirname(file), spec)).startsWith("..");
        if (!inside) offenders.push(`${relative(CORE_SRC, file)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("S106: packages/core calls no clock, randomness, network or process API", () => {
    const offenders = files.filter((f) => FORBIDDEN_GLOBALS.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))).map((f) => relative(CORE_SRC, f));
    expect(offenders).toEqual([]);
  });
});
