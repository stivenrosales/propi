// Minimal XLSX reader: first worksheet, shared and inline strings, numbers, booleans. No dependencies.
import { unzip } from "./zip.ts";

export type CellValue = string | number | boolean;

const unescapeXml = (s: string) =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Concatenated text runs (<t>) inside one <si> or <is>. */
const textRuns = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1] ?? "")).join("");

const columnIndex = (letters: string) => [...letters].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Raw rows of the first worksheet, cells placed by column letter. */
export function readXlsxGrid(buf: Buffer): CellValue[][] {
  const files = unzip(buf);
  const sst = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1] ?? ""));
  const sheet = files.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("xlsx has no xl/worksheets/sheet1.xml");
  const rows: CellValue[][] = [];
  for (const r of sheet.toString("utf8").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: CellValue[] = [];
    for (const c of (r[1] ?? "").matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = columnIndex(c[1] ?? "A");
      const type = /\bt="(\w+)"/.exec(c[2] ?? "")?.[1];
      const body = c[3] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: CellValue;
      if (type === "inlineStr") value = textRuns(body);
      else if (v === undefined) value = "";
      else if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "b") value = v === "1";
      else if (type === "str" || type === "e") value = unescapeXml(v);
      else value = Number(v);
      row[col] = value;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
    rows.push(row);
  }
  return rows;
}

/** First worksheet as objects keyed by the header row. Missing cells read as "". */
export function readXlsxRows(buf: Buffer): Record<string, CellValue>[] {
  const [header, ...body] = readXlsxGrid(buf);
  if (!header) return [];
  const names = header.map(String);
  return body.map((r) => Object.fromEntries(names.map((h, i) => [h, r[i] ?? ""])));
}
