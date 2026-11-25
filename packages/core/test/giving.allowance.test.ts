import { describe, expect, test } from "vitest";
import { allowanceDayFor, consumesAllowance, dailyLimit, localDate, remainingAllowance, type PosInt } from "../src/index.ts";
import { at, record, settings } from "./fixtures.ts";

describe("daily allowance", () => {
  test("S25: the daily allowance defaults to the workspace value and can be overridden per member", () => {
    expect(settings().defaultDailyAllowance).toBe(5);
    expect(dailyLimit(record("u1"), settings())).toBe(5);
    expect(dailyLimit(record("u1", { dailyLimitOverride: 8 as PosInt }), settings())).toBe(8);
    expect(dailyLimit(record("u1", { dailyLimitOverride: 10 as PosInt, role: "admin" }), settings())).toBe(10);
    expect(remainingAllowance(5, 3)).toBe(2);
  });

  test("S26: admins use the admin default allowance; approvers use the member default", () => {
    const s = settings({ adminDailyAllowance: 20 as PosInt });
    expect(dailyLimit(record("a1", { role: "admin" }), s)).toBe(20);
    expect(dailyLimit(record("p1", { role: "approver" }), s)).toBe(5);
  });

  test("S27: allowance days roll over at 00:00 in the workspace timezone, so yesterday's usage does not carry", () => {
    const tz = "America/Lima";
    const beforeMidnight = at("2026-11-26T04:59:00Z"); // 23:59 Lima, 25th
    const afterMidnight = at("2026-11-26T05:01:00Z"); // 00:01 Lima, 26th
    expect(localDate(beforeMidnight, tz)).toBe("2026-11-25");
    expect(allowanceDayFor("message", afterMidnight, tz)).toBe("2026-11-26");
    expect(allowanceDayFor("reaction", beforeMidnight, tz)).toBe("2026-11-25");
  });

  test("sticker gifts are exempt from the allowance (hook for the stickers module)", () => {
    expect(consumesAllowance("sticker")).toBe(false);
    expect(consumesAllowance("message")).toBe(true);
    expect(allowanceDayFor("sticker", at("2026-11-26T05:01:00Z"), "America/Lima")).toBeNull();
  });
});
