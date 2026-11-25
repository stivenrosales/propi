// Scheduler due logic (architecture §5): local time in the workspace timezone (S3) decides when each
// periodic job first fires; the command key makes it exactly-once.
import { describe, expect, test } from "vitest";
import type { Instant, LocalDate } from "@propi/app";
import { ledgerCheckDue, localTime, monthlyDue, nudgeHourReached, weeklyDue } from "../src/due.ts";

const at = (iso: string) => Date.parse(iso) as Instant;
const LIMA = "America/Lima"; // UTC-5, no DST

describe("localTime", () => {
  test("S3: the date, weekday and hour come from the workspace timezone", () => {
    // Monday 2026-11-30 03:00 UTC is still Sunday 22:00 in Lima.
    expect(localTime(at("2026-11-30T03:00:00Z"), LIMA)).toEqual({ date: "2026-11-29", weekday: 7, hour: 22, month: "2026-11", day: 29 });
    expect(localTime(at("2026-11-30T03:00:00Z"), "UTC")).toMatchObject({ date: "2026-11-30", weekday: 1, hour: 3 });
  });
});

describe("weekly jobs (S84 report, S89 isolation)", () => {
  test("due on Monday from 09:00 local, keyed by ISO week", () => {
    expect(weeklyDue(localTime(at("2026-11-30T13:59:00Z"), LIMA))).toBeNull(); // 08:59 Lima
    expect(weeklyDue(localTime(at("2026-11-30T14:00:00Z"), LIMA))).toBe("2026-W49");
    expect(weeklyDue(localTime(at("2026-11-30T23:00:00Z"), LIMA))).toBe("2026-W49");
    expect(weeklyDue(localTime(at("2026-12-01T14:00:00Z"), LIMA))).toBeNull(); // Tuesday
  });
});

describe("S86 nudge", () => {
  test("goes out from 15:00 local; the weekday is core's setting", () => {
    expect(nudgeHourReached(localTime(at("2026-11-27T19:59:00Z"), LIMA))).toBe(false);
    expect(nudgeHourReached(localTime(at("2026-11-27T20:00:00Z"), LIMA))).toBe(true);
  });
});

describe("monthly jobs (S90 reciprocity, S91 digest)", () => {
  test("the previous month, during the first three days from 09:00 local", () => {
    expect(monthlyDue(localTime(at("2026-12-01T13:00:00Z"), LIMA))).toBeNull(); // 08:00
    expect(monthlyDue(localTime(at("2026-12-01T14:00:00Z"), LIMA))).toBe("2026-11");
    expect(monthlyDue(localTime(at("2026-12-03T23:00:00Z"), LIMA))).toBe("2026-11");
    expect(monthlyDue(localTime(at("2026-12-04T14:00:00Z"), LIMA))).toBeNull();
    expect(monthlyDue(localTime(at("2027-01-01T14:00:00Z"), LIMA))).toBe("2026-12");
  });
});

describe("S34 nightly ledger check", () => {
  test("once per local date after 02:00", () => {
    const t = localTime(at("2026-11-25T08:00:00Z"), LIMA); // 03:00 Lima
    expect(ledgerCheckDue(t, null)).toBe(true);
    expect(ledgerCheckDue(t, "2026-11-25" as LocalDate)).toBe(false);
    expect(ledgerCheckDue(t, "2026-11-24" as LocalDate)).toBe(true);
    expect(ledgerCheckDue(localTime(at("2026-11-25T06:00:00Z"), LIMA), "2026-11-24" as LocalDate)).toBe(false); // 01:00
  });
});
