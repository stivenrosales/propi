// S101: parsing HeyTaco's CSV and XLSX exports. Synthetic files only, in a temp dir outside the repo.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { parseCsv, readHeyTacoExport, readXlsxRows, unzip } from "../src/index.ts";
import { activityCsv, sampleExport, writeHeyTacoExport, xlsx, zip } from "../src/testing/index.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "propi-heytaco-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("S101 CSV", () => {
  test("S101: RFC 4180 fields: BOM, CRLF, quoted commas, escaped quotes and embedded newlines", () => {
    const rows = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi""\nthere"\r\n2,,\r\n');
    expect(rows).toEqual([
      { a: "1", b: "x, y", c: 'say "hi"\nthere' },
      { a: "2", b: "", c: "" },
    ]);
  });

  test("S101: a missing final newline still yields the last row; blank lines are skipped", () => {
    expect(parseCsv("a,b\n\n1,2")).toEqual([{ a: "1", b: "2" }]);
  });
});

describe("S101 XLSX", () => {
  test("S101: zip entries round-trip through deflate", () => {
    const files = unzip(zip({ "a.txt": "hello", "b/c.xml": "<x>ñ</x>" }));
    expect(files.get("a.txt")?.toString("utf8")).toBe("hello");
    expect(files.get("b/c.xml")?.toString("utf8")).toBe("<x>ñ</x>");
  });

  test("S101: shared strings, numbers, booleans and sparse cells are read by column", () => {
    const rows = readXlsxRows(xlsx([["Name", "N", "Flag", "Note"], ["a & b", 12, true, null], ["c", 0, false, "<tag>"]]));
    expect(rows).toEqual([
      { Name: "a & b", N: 12, Flag: true, Note: "" },
      { Name: "c", N: 0, Flag: false, Note: "<tag>" },
    ]);
  });

  test("S101: inline strings are read too", () => {
    expect(readXlsxRows(xlsx([["H"], ["v"]], { inline: true }))).toEqual([{ H: "v" }]);
  });

  test("S101: a file that is not a zip is refused", () => {
    expect(() => readXlsxRows(Buffer.from("not a zip at all, definitely"))).toThrow(/zip/);
  });
});

describe("S101 export directory", () => {
  test("S101: reads users, every activity CSV and every redemption XLSX into typed rows", () => {
    const dir = tmp();
    writeHeyTacoExport(dir, sampleExport());
    writeFileSync(join(dir, "taco-data(2025-01-01--2025-12-31).csv"), activityCsv([{ to: "a@example.test", from: "b@example.test", at: "2025-05-05 08:00:00", tacos: 1, type: "message" }]));
    writeFileSync(join(dir, "notes.txt"), "ignored");
    const data = readHeyTacoExport(dir);

    expect(data.users).toEqual([
      { uid: "U1", email: "ana@example.test", dailyLimit: 5, given: 1, received: 3, bonuses: 2, redeemable: 1 },
      { uid: "U2", email: "bob@example.test", dailyLimit: 8, given: 3, received: 1, bonuses: 0, redeemable: 1 },
    ]);
    expect(data.activity.map((f) => [f.file, f.rows.length])).toEqual([
      ["taco-data(2025-01-01--2025-12-31).csv", 1],
      ["taco-data(2026-01-01--2026-12-31).csv", 4],
    ]);
    expect(data.activity[1]?.rows[0]).toEqual({
      receiverEmail: "ana@example.test",
      giverEmail: "bob@example.test",
      receiverName: "ana",
      giverName: "bob",
      timestamp: "2026-01-10 09:30:00",
      channel: "tacos",
      message: 'big "thanks", team\nreally',
      tacos: 2,
      tags: "",
      type: "message",
    });
    expect(data.redemptions[0]?.rows).toEqual([
      { uid: "U1", email: "ana@example.test", timestamp: "2026-01-13 12:00:00", title: "Voucher", amount: 4, fulfilled: true },
      { uid: "U9", email: "gone@example.test", timestamp: "2026-01-14 12:00:00", title: "Voucher", amount: 1, fulfilled: false },
    ]);
  });

  test("S101: a missing required column names the file and the column", () => {
    const dir = tmp();
    writeHeyTacoExport(dir, sampleExport());
    writeFileSync(join(dir, "taco-data(bad).csv"), "Receiver Email,Giver Email\r\na@example.test,b@example.test\r\n");
    expect(() => readHeyTacoExport(dir)).toThrow(/taco-data\(bad\)\.csv: missing column "Timestamp \(America\/Bogota\)"/);
  });

  test("S101: a directory without users.xlsx is refused", () => {
    expect(() => readHeyTacoExport(tmp())).toThrow(/users\.xlsx/);
  });
});
