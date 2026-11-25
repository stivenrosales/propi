import { describe, expect, test } from "vitest";
import { canApprove, canChangeRole, canReceive, installerMember, resolveGiver } from "../src/index.ts";
import { m, memberActor, record, settings } from "./fixtures.ts";

describe("members and roles", () => {
  test("S5: the installer becomes the first admin", () => {
    expect(installerMember(m("u1"))).toEqual({ id: m("u1"), role: "admin", active: true, dailyLimitOverride: null });
  });

  test("S5: only admins change roles, and nobody changes their own role", () => {
    expect(canChangeRole(memberActor("a1", "admin"), m("u2"))).toBe(true);
    expect(canChangeRole(memberActor("a1", "admin"), m("a1"))).toBe(false);
    expect(canChangeRole(memberActor("u1", "member"), m("u2"))).toBe(false);
    expect(canChangeRole(memberActor("p1", "approver"), m("u2"))).toBe(false);
  });

  test("S6: approvers and admins may approve; plain members may not", () => {
    expect(canApprove(memberActor("p1", "approver"))).toBe(true);
    expect(canApprove(memberActor("a1", "admin"))).toBe(true);
    expect(canApprove(memberActor("u1", "member"))).toBe(false);
  });

  test("S7: a deactivated member can neither give nor receive", () => {
    const off = record("u1", { active: false });
    expect(resolveGiver(memberActor("u1"), off, settings())).toEqual({ ok: false, error: { code: "inactive_member" } });
    expect(canReceive(off)).toBe(false);
    expect(canReceive(record("u2"))).toBe(true);
  });

  test("S8: bots never receive; they may give only when the workspace setting is on", () => {
    const bot = { kind: "bot", platformUserId: "B1" } as const;
    expect(resolveGiver(bot, null, settings({ botsMayGive: false }))).toEqual({
      ok: false,
      error: { code: "bots_may_not_give" },
    });
    const allowed = resolveGiver(bot, null, settings({ botsMayGive: true }));
    expect(allowed).toEqual({
      ok: true,
      giver: { id: m("bot:B1"), isBot: true, role: "member", active: true, dailyLimitOverride: null },
    });
    expect(canReceive(null)).toBe(false);
  });
});
