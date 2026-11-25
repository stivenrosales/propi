// RFC 4180 CSV parser (quoted fields, escaped quotes, embedded newlines, BOM, CRLF).

export function parseCsvGrid(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Rows as objects keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const [header, ...body] = parseCsvGrid(text);
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}
