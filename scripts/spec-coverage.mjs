#!/usr/bin/env node
// Spec coverage harness (T2).
//
// Parses every rule id from docs/spec.md (S1..S108 plus S76a) and every test
// title in packages/*/test and apps/*/test that mentions a rule id, then prints
// "covered X of Y rules" and the uncovered ids. Always exits 0: it is a report,
// not a gate.
//
// Usage: node scripts/spec-coverage.mjs

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const RULE = /\bS\d+a?\b/g;

/** Rule ids defined by the spec: lines shaped like "- **S12 [HT]** ...". */
function specRules() {
  const text = readFileSync(join(root, "docs", "spec.md"), "utf8");
  const ids = new Set();
  for (const m of text.matchAll(/^\s*-\s+\*\*(S\d+a?)\b/gm)) ids.add(m[1]);
  return [...ids].sort(compareIds);
}

function compareIds(a, b) {
  const na = Number.parseInt(a.slice(1), 10);
  const nb = Number.parseInt(b.slice(1), 10);
  return na - nb || a.localeCompare(b);
}

function* testFiles(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* testFiles(path);
    else if (/\.test\.[cm]?[jt]sx?$/.test(name)) yield path;
  }
}

/** Rule ids mentioned in test/describe titles: test("S10: ...", ...), it(`S9 ...`), describe('S23 ...'). */
function coveredRules() {
  const covered = new Set();
  const title = /\b(?:test|it|describe)(?:\.\w+)*\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const group of ["packages", "apps"]) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const pkg of readdirSync(base)) {
      for (const file of testFiles(join(base, pkg, "test"))) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(title)) {
          for (const id of m[2].matchAll(RULE)) covered.add(id[0]);
        }
      }
    }
  }
  return covered;
}

const rules = specRules();
const covered = coveredRules();
const uncovered = rules.filter((id) => !covered.has(id));
console.log(`covered ${rules.length - uncovered.length} of ${rules.length} rules`);
console.log(uncovered.length === 0 ? "uncovered: none" : `uncovered: ${uncovered.join(" ")}`);
process.exit(0);
