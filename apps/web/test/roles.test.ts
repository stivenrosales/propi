// S5, S6: role guards for the member, approver and admin areas.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { allows, canChangeRoleOf, decideAccess } from "../src/server/roles.ts";

describe("S5 S6 role guards", () => {
  test("admin ⊇ approver ⊇ member", () => {
    expect(allows("member", "member")).toBe(true);
    expect(allows("member", "approver")).toBe(false);
    expect(allows("member", "admin")).toBe(false);
    expect(allows("approver", "approver")).toBe(true);
    expect(allows("approver", "admin")).toBe(false);
    expect(allows("admin", "admin")).toBe(true);
    expect(allows("admin", "approver")).toBe(true);
  });

  test("no session or a deactivated member goes to sign in; a missing role goes home", () => {
    expect(decideAccess(null, "member")).toEqual({ ok: false, redirect: "/signin" });
    expect(decideAccess({ role: "admin", active: false }, "member")).toEqual({ ok: false, redirect: "/signin" });
    expect(decideAccess({ role: "member", active: true }, "admin")).toEqual({ ok: false, redirect: "/app?denied=1" });
    expect(decideAccess({ role: "approver", active: true }, "approver")).toEqual({ ok: true, redirect: null });
  });

  test("S5: only admins change roles, and never their own", () => {
    expect(canChangeRoleOf({ memberId: "boss", role: "admin" }, "ana")).toBe(true);
    expect(canChangeRoleOf({ memberId: "boss", role: "admin" }, "boss")).toBe(false);
    expect(canChangeRoleOf({ memberId: "rita", role: "approver" }, "ana")).toBe(false);
  });
});

// Every admin page asks for admin, except the two review queues that approvers use (S6).
describe("S6 page guards", () => {
  const root = join(import.meta.dirname, "../src/app/(admin)/admin");
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === "page.tsx") pages.push(p);
    }
  };
  walk(root);
  const REVIEW = ["redemptions", "submissions"];

  test("there are admin pages to check", () => expect(pages.length).toBeGreaterThan(10));
  test.each(pages.map((p) => [p.slice(root.length) || "/", p]))("%s", (_name, path) => {
    const src = readFileSync(path, "utf8");
    const review = REVIEW.some((r) => path.includes(`/${r}/`));
    expect(src).toContain(review ? 'requireViewer("approver")' : 'requireViewer("admin")');
  });

  test("approver actions are only the two review transitions; every other admin action needs admin", () => {
    const src = readFileSync(join(import.meta.dirname, "../src/server/actions/admin.ts"), "utf8");
    const approverActions = [...src.matchAll(/export async function (\w+)[^{]*\{\s*const v = await actionViewer\("approver"\)/g)].map((m) => m[1]);
    expect(approverActions.sort()).toEqual(["reviewSubmissionAction", "transitionRedemptionAction"]);
    const unguarded = [...src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{(?!\s*const v = await actionViewer\()/g)].map((m) => m[1]);
    expect(unguarded).toEqual([]);
  });
});
