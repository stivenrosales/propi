// Synthetic HeyTaco export writer for tests. Produces real CSV and XLSX files with HeyTaco's headers.
// Never feed it real data: fixtures are hand-made.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

export type Cell = string | number | boolean | null;

/** A minimal zip archive (deflate), enough for XLSX readers. */
export function zip(files: Readonly<Record<string, string>>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8");
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((t, b) => t + b.length, 0);
  const count = Object.keys(files).length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

/**
 * One-sheet XLSX. Strings go to sharedStrings by default; `inline: true` writes inline strings instead.
 * null cells are omitted (sparse rows, as Excel writes them).
 */
export function xlsx(rows: readonly (readonly Cell[])[], opts: { inline?: boolean } = {}): Buffer {
  const shared: string[] = [];
  const index = new Map<string, number>();
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (v === null) return "";
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      if (typeof v === "boolean") return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
      if (opts.inline) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
      let i = index.get(v);
      if (i === undefined) {
        i = shared.push(v) - 1;
        index.set(v, i);
      }
      return `<c r="${ref}" t="s"><v>${i}</v></c>`;
    });
    return `<row r="${r + 1}">${cells.join("")}</row>`;
  });
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>`,
    "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8"?><sst count="${shared.length}">${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${sheetRows.join("")}</sheetData></worksheet>`,
  });
}

const csvField = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const ACTIVITY_HEADER = ["Receiver Name", "Receiver Email", "Giver Name", "Giver Email", "Timestamp (America/Bogota)", "Channel Name", "Message", "Tacos", "Tags", "Type"] as const;
export const USERS_HEADER = ["Name", "Email", "Level", "UID", "Daily Taco Limit", "Total Tacos Given", "Total Tacos Received", "Total Taco Bonuses", "Total Redeemable Tacos", "Total Rewards Redeemed"] as const;
export const REDEMPTION_HEADER = ["User ID", "Redemption Amount", "Username", "Display name", "Email", "Timestamp (America/Bogota)", "Title", "Reward Cost (USD)", "Fulfilled", "Type", "Metadata"] as const;

export interface FixtureActivity {
  readonly to: string;
  readonly from: string;
  readonly at: string;
  readonly tacos: number;
  readonly type: "message" | "reaction" | "sticker";
  readonly message?: string;
  readonly channel?: string;
  readonly tags?: string;
}
export interface FixtureUser {
  readonly uid: string;
  readonly email: string;
  readonly limit?: number;
  readonly given: number;
  readonly received: number;
  readonly bonuses?: number;
  readonly redeemable: number;
}
export interface FixtureRedemption {
  readonly uid: string;
  readonly email: string;
  readonly at: string;
  readonly amount: number;
  readonly fulfilled: boolean;
  readonly title?: string;
}

/** CSV text with HeyTaco's activity header (BOM + CRLF, as exported). */
export function activityCsv(rows: readonly FixtureActivity[]): string {
  const lines = [ACTIVITY_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [r.to.split("@")[0] ?? "", r.to, r.from.split("@")[0] ?? "", r.from, r.at, r.channel ?? "tacos", r.message ?? `thanks :taco:`, r.tacos, r.tags ?? "", r.type]
        .map(csvField)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Writes users.xlsx, one activity CSV and one redemption XLSX into `dir`. */
export function writeHeyTacoExport(dir: string, data: { users: readonly FixtureUser[]; activity: readonly FixtureActivity[]; redemptions: readonly FixtureRedemption[] }): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "users.xlsx"),
    xlsx([
      USERS_HEADER,
      ...data.users.map((u) => [u.email.split("@")[0] ?? "", u.email, 1, u.uid, u.limit ?? 5, u.given, u.received, u.bonuses ?? 0, u.redeemable, 0]),
    ]),
  );
  writeFileSync(join(dir, "taco-data(2026-01-01--2026-12-31).csv"), activityCsv(data.activity));
  writeFileSync(
    join(dir, "redemption-data(2026-01-01--2026-12-31).xlsx"),
    xlsx([
      REDEMPTION_HEADER,
      ...data.redemptions.map((r) => [r.uid, String(r.amount), "user", "User", r.email, r.at, r.title ?? "Voucher", 3.5, r.fulfilled, "individual", ""]),
    ]),
  );
}

/** A small consistent export: totals in users.xlsx equal what the rows produce. */
export function sampleExport() {
  return {
    users: [
      { uid: "U1", email: "ana@example.test", given: 1, received: 3, bonuses: 2, redeemable: 1 },
      { uid: "U2", email: "bob@example.test", limit: 8, given: 3, received: 1, redeemable: 1 },
    ],
    activity: [
      { to: "ana@example.test", from: "bob@example.test", at: "2026-01-10 09:30:00", tacos: 2, type: "message", message: 'big "thanks", team\nreally' },
      { to: "bob@example.test", from: "ana@example.test", at: "2026-01-10 09:31:00", tacos: 1, type: "reaction" },
      { to: "ana@example.test", from: "gone@example.test", at: "2026-01-11 10:00:00", tacos: 1, type: "sticker" },
      { to: "gone@example.test", from: "bob@example.test", at: "2026-01-12 11:00:00", tacos: 1, type: "message" },
    ],
    redemptions: [
      { uid: "U1", email: "ana@example.test", at: "2026-01-13 12:00:00", amount: 4, fulfilled: true },
      { uid: "U9", email: "gone@example.test", at: "2026-01-14 12:00:00", amount: 1, fulfilled: false },
    ],
  } satisfies Parameters<typeof writeHeyTacoExport>[1];
}
