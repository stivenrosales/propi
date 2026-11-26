// S6: every viewer sees members by their stored Slack display name and avatar, with the id-derived
// label as the fallback.
import { describe, expect, test } from "vitest";
import type { MemberId, MemberRecord } from "@propi/core";
import { memberDirectory } from "../src/lib/format.ts";

const rec = (id: string, over: Partial<MemberRecord> = {}): MemberRecord => ({ id: id as MemberId, role: "member", active: true, dailyLimitOverride: null, ...over });

describe("memberDirectory (S6)", () => {
  const dir = memberDirectory([
    rec("0b7c8e2a-1111-8222-9333-a4b5c687ead8", { displayName: "Ana Torres", avatarUrl: "https://img/ana.png" }),
    rec("5f0e1d2c-1111-8222-9333-a4b5c6123456", { displayName: null, avatarUrl: null }),
    rec("bob-ruiz"),
  ], "en");

  test("label uses the stored display name", () => {
    expect(dir.label("0b7c8e2a-1111-8222-9333-a4b5c687ead8")).toBe("Ana Torres");
  });

  test("label falls back to the id-derived label, and to Someone for no id", () => {
    expect(dir.label("5f0e1d2c-1111-8222-9333-a4b5c6123456")).toBe("Member 123456");
    expect(dir.label("bob-ruiz")).toBe("Bob Ruiz");
    expect(dir.label("unknown-1234-5678-abcdef")).toBe("Member abcdef");
    expect(dir.label(null)).toBe("Someone");
  });

  test("i18n S1: the fallbacks read in Spanish for a Spanish reader", () => {
    const es = memberDirectory([rec("5f0e1d2c-1111-8222-9333-a4b5c6123456"), rec("bob-ruiz")], "es");
    expect(es.label("5f0e1d2c-1111-8222-9333-a4b5c6123456")).toBe("Miembro 123456");
    expect(es.label("bob-ruiz")).toBe("Bob Ruiz");
    expect(es.label(null)).toBe("Alguien");
  });

  test("avatar returns the stored URL or null", () => {
    expect(dir.avatar("0b7c8e2a-1111-8222-9333-a4b5c687ead8")).toBe("https://img/ana.png");
    expect(dir.avatar("bob-ruiz")).toBeNull();
    expect(dir.avatar(undefined)).toBeNull();
  });
});
