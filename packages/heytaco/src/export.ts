// S101: read a HeyTaco export directory into typed rows. Header names live here, nowhere else.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { HeyTacoActivityRow, HeyTacoExport, HeyTacoFile, HeyTacoRedemptionRow, HeyTacoUserRow } from "@propi/core";
import { parseCsv } from "./csv.ts";
import { readXlsxRows, type CellValue } from "./xlsx.ts";

const TS = "Timestamp (America/Bogota)";

export const ACTIVITY_COLUMNS = ["Receiver Email", "Giver Email", TS, "Channel Name", "Message", "Tacos", "Tags", "Type"] as const;
export const USER_COLUMNS = ["Email", "UID", "Daily Taco Limit", "Total Tacos Given", "Total Tacos Received", "Total Taco Bonuses", "Total Redeemable Tacos"] as const;
export const REDEMPTION_COLUMNS = ["User ID", "Redemption Amount", "Email", TS, "Title", "Fulfilled"] as const;

type Row = Readonly<Record<string, CellValue>>;

function requireColumns(file: string, rows: readonly Row[], columns: readonly string[]): void {
  const first = rows[0];
  if (!first) return;
  for (const c of columns) if (!(c in first)) throw new Error(`${file}: missing column "${c}"`);
}

const str = (v: CellValue | undefined) => (v === undefined ? "" : String(v).trim());
/** Numbers may arrive as numbers or numeric strings; anything else is NaN so the decider refuses it. */
const num = (v: CellValue | undefined) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : Number.NaN);

export function activityRows(file: string, text: string): HeyTacoFile<HeyTacoActivityRow> {
  const rows = parseCsv(text);
  requireColumns(file, rows, ACTIVITY_COLUMNS);
  return {
    file,
    rows: rows.map((r) => ({
      receiverEmail: str(r["Receiver Email"]),
      giverEmail: str(r["Giver Email"]),
      receiverName: str(r["Receiver Name"]),
      giverName: str(r["Giver Name"]),
      timestamp: str(r[TS]),
      channel: r["Channel Name"] ?? "",
      message: r.Message ?? "",
      tacos: num(r.Tacos),
      tags: r.Tags ?? "",
      type: str(r.Type),
    })),
  };
}

export function userRows(file: string, buf: Buffer): HeyTacoUserRow[] {
  const rows = readXlsxRows(buf);
  requireColumns(file, rows, USER_COLUMNS);
  return rows.map((r) => ({
    uid: str(r.UID),
    email: str(r.Email),
    dailyLimit: num(r["Daily Taco Limit"]),
    given: num(r["Total Tacos Given"]),
    received: num(r["Total Tacos Received"]),
    bonuses: num(r["Total Taco Bonuses"]),
    redeemable: num(r["Total Redeemable Tacos"]),
  }));
}

export function redemptionRows(file: string, buf: Buffer): HeyTacoFile<HeyTacoRedemptionRow> {
  const rows = readXlsxRows(buf);
  requireColumns(file, rows, REDEMPTION_COLUMNS);
  return {
    file,
    rows: rows.map((r) => ({
      uid: str(r["User ID"]),
      email: str(r.Email),
      timestamp: str(r[TS]),
      title: str(r.Title),
      amount: num(r["Redemption Amount"]),
      fulfilled: r.Fulfilled ?? "",
    })),
  };
}

/** Reads users.xlsx, every taco-data*.csv and every redemption-data*.xlsx, in file-name order. */
export function readHeyTacoExport(dir: string): HeyTacoExport {
  const usersPath = join(dir, "users.xlsx");
  if (!existsSync(usersPath)) throw new Error(`${dir}: users.xlsx not found`);
  const names = readdirSync(dir).sort();
  return {
    users: userRows("users.xlsx", readFileSync(usersPath)),
    activity: names.filter((f) => f.startsWith("taco-data") && f.endsWith(".csv")).map((f) => activityRows(f, readFileSync(join(dir, f), "utf8"))),
    redemptions: names.filter((f) => f.startsWith("redemption-data") && f.endsWith(".xlsx")).map((f) => redemptionRows(f, readFileSync(join(dir, f)))),
  };
}
