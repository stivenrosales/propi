#!/usr/bin/env node
// Replay proof for the candidate-3 ledger model (Node 24, no dependencies).
//
// Reads HeyTaco exports, turns them into ledger entries exactly as the importer
// would (one GIFT entry per CSV row, one SPEND entry per redemption row, with a
// deterministic dedupe key), replays the ledger into balances, and compares the
// result with users.xlsx. Output is counts only: no names, emails or ids.
//
// Usage: node replay.mjs [path/to/data/heytaco]

import { readFileSync, readdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "/Users/stivenkevinrosalescasas/tacos/data/heytaco");

// ---------- minimal zip + xlsx reader ----------
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(local + 26);
    const lxlen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lnlen + lxlen;
    const raw = buf.subarray(start, start + csize);
    files.set(name, method === 8 ? inflateRawSync(raw) : raw);
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

const xmlText = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function readSheet(path) {
  const files = unzip(readFileSync(path));
  const shared = [];
  const sst = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  }
  const xml = files.get("xl/worksheets/sheet1.xml").toString("utf8");
  const rows = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = [...c[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const type = /t="(\w+)"/.exec(c[2])?.[1];
      const v = c[3] ? /<v>([\s\S]*?)<\/v>/.exec(c[3])?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3])?.[1] : undefined;
      row[col] = v === undefined ? "" : type === "s" ? shared[Number(v)] : type === "b" ? v === "1" : xmlText(v);
    }
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ---------- RFC 4180 CSV ----------
function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ---------- the ledger model under test ----------
// Entry kinds mirror core-types.ts. Only the kinds the import produces are used here.
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 24);

/** Append-only store: the dedupe key is the uniqueness constraint (S105). */
class Ledger {
  entries = [];
  keys = new Set();
  append(e) {
    if (this.keys.has(e.dedupeKey)) return false; // ON CONFLICT DO NOTHING
    this.keys.add(e.dedupeKey);
    this.entries.push(Object.freeze({ seq: this.entries.length + 1, ...e }));
    return true;
  }
}

/** The single projection function (S31-S33). Pure fold over entries. */
function replay(entries) {
  const b = new Map();
  const get = (m) => b.get(m) ?? (b.set(m, { received: 0, given: 0, redeemable: 0 }), b.get(m));
  for (const e of entries) {
    switch (e.kind) {
      case "gift":
        get(e.memberId).received += e.amount;
        get(e.memberId).redeemable += e.amount;
        get(e.counterpartId).given += e.amount;
        break;
      case "gift_reversal":
        get(e.memberId).received -= e.amount;
        get(e.memberId).redeemable -= e.amount;
        get(e.counterpartId).given -= e.amount;
        break;
      case "bonus": case "rule_award": case "quest_reward": case "refund":
        get(e.memberId).redeemable += e.amount; break;
      case "spend": case "deduction":
        get(e.memberId).redeemable -= e.amount; break;
      default: throw new Error(`unknown kind ${e.kind}`);
    }
  }
  return b;
}

// ---------- importer (S101-S105) ----------
function importAll(ledger) {
  const users = readSheet(join(dir, "users.xlsx"));
  const memberByEmail = new Map();
  const memberByUid = new Map();
  for (const u of users) {
    const id = `m:${sha(u.UID)}`; // opaque member id; Slack uid is the identity (S102)
    memberByUid.set(u.UID, id);
    memberByEmail.set(u.Email.toLowerCase(), id);
  }
  // Historical people: matched by email only, imported as deactivated (S102).
  const historical = new Set();
  const memberFor = (email) => {
    const k = email.toLowerCase();
    if (!memberByEmail.has(k)) { memberByEmail.set(k, `m:${sha("email:" + k)}`); historical.add(k); }
    return memberByEmail.get(k);
  };

  const files = readdirSync(dir).sort();
  let gifts = 0, dupRows = 0;
  const kinds = { message: 0, reaction: 0, sticker: 0 };
  for (const f of files.filter((f) => f.startsWith("taco-data") && f.endsWith(".csv"))) {
    const occurrences = new Map(); // identical rows keep their multiplicity (HeyTaco counted them)
    for (const r of parseCsv(readFileSync(join(dir, f), "utf8"))) {
      const content = [r["Receiver Email"], r["Giver Email"], r["Timestamp (America/Bogota)"], r["Channel Name"], r.Message, r.Tacos, r.Type].join("\u0001");
      const n = (occurrences.get(content) ?? 0) + 1;
      occurrences.set(content, n);
      if (n > 1) dupRows++;
      kinds[r.Type] = (kinds[r.Type] ?? 0) + 1;
      gifts++;
      ledger.append({
        kind: "gift",
        dedupeKey: `import:heytaco:gift:${sha(content)}:${n}`,
        memberId: memberFor(r["Receiver Email"]),
        counterpartId: memberFor(r["Giver Email"]),
        amount: Number(r.Tacos),
        source: r.Type, // message | reaction | sticker (S76a)
        consumesAllowance: false, // imported history never touches today's allowance
        at: r["Timestamp (America/Bogota)"],
      });
    }
  }

  let redemptions = 0, unmatchedRedemptions = 0;
  const fulfilled = { true: 0, false: 0 };
  for (const f of files.filter((f) => f.startsWith("redemption-data") && f.endsWith(".xlsx"))) {
    const occurrences = new Map();
    for (const r of readSheet(join(dir, f))) {
      // S102: Slack user id first, else email (people who left are not in users.xlsx).
      let memberId = memberByUid.get(r["User ID"]);
      if (!memberId && r.Email) { memberId = memberFor(r.Email); unmatchedRedemptions++; }
      if (!memberId) throw new Error("redemption row with neither a known uid nor an email");
      const content = [r["User ID"], r["Timestamp (America/Bogota)"], r.Title, r["Redemption Amount"]].join("\u0001");
      const n = (occurrences.get(content) ?? 0) + 1;
      occurrences.set(content, n);
      const redemptionId = `r:${sha(content)}:${n}`;
      redemptions++;
      fulfilled[String(r.Fulfilled === true || r.Fulfilled === "1")]++; // S104: 1 -> fulfilled, 0 -> approved
      ledger.append({
        kind: "spend",
        dedupeKey: `import:heytaco:spend:${redemptionId}`,
        memberId,
        amount: Number(r["Redemption Amount"]),
        cause: { type: "redemption", id: redemptionId },
        at: r["Timestamp (America/Bogota)"],
      });
    }
  }

  // Bonuses: HeyTaco exports only a per-user total, so one bonus entry per member with a non-zero total.
  let bonusEntries = 0;
  for (const u of users) {
    const amount = Number(u["Total Taco Bonuses"]);
    if (amount > 0 && ledger.append({ kind: "bonus", dedupeKey: `import:heytaco:bonus:${sha(u.UID)}`, memberId: memberByUid.get(u.UID), amount })) bonusEntries++;
  }
  return { users, memberByUid, gifts, dupRows, kinds, redemptions, unmatchedRedemptions, fulfilled, bonusEntries, historical: historical.size };
}

// ---------- run ----------
const ledger = new Ledger();
const s = importAll(ledger);
const firstCount = ledger.entries.length;
importAll(ledger); // S105: second run must append nothing
const secondCount = ledger.entries.length;

const balances = replay(ledger.entries);
const diffs = { received: 0, given: 0, redeemable: 0 };
let usersWithAnyDiff = 0;
for (const u of s.users) {
  const b = balances.get(s.memberByUid.get(u.UID)) ?? { received: 0, given: 0, redeemable: 0 };
  const d = {
    received: b.received !== Number(u["Total Tacos Received"]),
    given: b.given !== Number(u["Total Tacos Given"]),
    redeemable: b.redeemable !== Number(u["Total Redeemable Tacos"]),
  };
  for (const k of Object.keys(d)) if (d[k]) diffs[k]++;
  if (d.received || d.given || d.redeemable) usersWithAnyDiff++;
}

const totalGiven = s.users.reduce((a, u) => a + (balances.get(s.memberByUid.get(u.UID))?.given ?? 0), 0);
console.log(JSON.stringify({
  csvRows: s.gifts,
  rowsByType: s.kinds,
  identicalDuplicateRowsKept: s.dupRows,
  redemptionRows: s.redemptions,
  redemptionRowsMatchedByEmailOnly: s.unmatchedRedemptions,
  redemptionsFulfilled: s.fulfilled.true,
  redemptionsApproved: s.fulfilled.false,
  bonusEntries: s.bonusEntries,
  historicalDeactivatedMembers: s.historical,
  currentMembers: s.users.length,
  ledgerEntries: firstCount,
  ledgerEntriesAfterSecondImport: secondCount,
  idempotent: firstCount === secondCount,
  givenByCurrentMembers: totalGiven,
  membersWithDiff: { received: diffs.received, given: diffs.given, redeemable: diffs.redeemable, any: usersWithAnyDiff },
}, null, 2));
process.exitCode = usersWithAnyDiff === 0 && firstCount === secondCount ? 0 : 1;
