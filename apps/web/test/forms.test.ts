// Admin form parsing: workspace settings (S1-S3, S25-S26) and webhook endpoint registration (S99).
// Validation is core's; these pin that the web layer hands it the right values.
import { describe, expect, test } from "vitest";
import { defaultSettings, nodeCrypto, type Actor, type MemberId, type WebhookEndpoint, type WorkspaceId } from "@propi/app";
import { formatExtraEmojis, parseExtraEmojis, parseWorkspaceSettings } from "../src/server/settings-form.ts";
import { registerEndpoint } from "../src/server/webhook-endpoints.ts";
import { errorMessage, memberLabel, readableText } from "../src/lib/format.ts";
import { parseTimeframe } from "../src/lib/timeframe.ts";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const valid = { primaryEmoji: ":taco:", singular: "taco", plural: "tacos", extraEmojis: ":fire: = 3", timezone: "America/Lima", defaultDailyAllowance: "5", adminDailyAllowance: "8", reactionsEnabled: "on", storeMessageText: "on" };

describe("S1-S3 S25-S26 workspace settings form", () => {
  test("a valid form becomes the settings, toggles off when unchecked", () => {
    const r = parseWorkspaceSettings(form(valid), defaultSettings());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.currency).toEqual({ primaryEmoji: ":taco:", singular: "taco", plural: "tacos", extraEmojis: new Map([[":fire:", 3]]) });
    expect(r.value).toMatchObject({ timezone: "America/Lima", defaultDailyAllowance: 5, adminDailyAllowance: 8, reactionsEnabled: true, storeMessageText: true, groupMentionsEnabled: false, botsMayGive: false });
  });

  test("core rejects an empty currency name or a non-integer emoji value", () => {
    expect(parseWorkspaceSettings(form({ ...valid, plural: " " }), defaultSettings())).toEqual({ ok: false, error: { code: "invalid_currency", field: "plural" } });
    expect(parseWorkspaceSettings(form({ ...valid, extraEmojis: ":fire: = 0" }), defaultSettings())).toEqual({ ok: false, error: { code: "invalid_currency", field: "extraEmojis" } });
    expect(parseWorkspaceSettings(form({ ...valid, extraEmojis: "fire = 2" }), defaultSettings())).toEqual({ ok: false, error: { code: "invalid_currency", field: "extraEmojis" } });
  });

  test("an unknown timezone or a non-positive allowance is refused", () => {
    expect(parseWorkspaceSettings(form({ ...valid, timezone: "Mars/Base" }), defaultSettings())).toEqual({ ok: false, error: { code: "invalid_field", field: "timezone" } });
    expect(parseWorkspaceSettings(form({ ...valid, defaultDailyAllowance: "0" }), defaultSettings())).toEqual({ ok: false, error: { code: "invalid_field", field: "defaultDailyAllowance" } });
  });

  test("extra emojis round-trip through the form text", () => {
    expect(formatExtraEmojis(parseExtraEmojis(":fire: = 3, :star: = 2"))).toBe(":fire: = 3, :star: = 2");
  });
});

describe("S99 webhook endpoint registration", () => {
  const WS = "ws-1" as WorkspaceId;
  const admin: Actor = { kind: "member", memberId: "boss" as MemberId, role: "admin" };
  const saved: WebhookEndpoint[] = [];
  let n = 0;
  const deps = { save: async (e: WebhookEndpoint) => void saved.push(e), crypto: nodeCrypto, ids: { next: () => `ep-${++n}` }, allowHttp: false };

  test("an admin gets a fresh secret once; the stored endpoint carries it for signing", async () => {
    const r = await registerEndpoint(deps, admin, WS, { url: "https://erp.example/hook", events: ["gift.given", "gift.given"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.secret).toMatch(/^whsec_[\w-]{40,}$/);
    expect(saved.at(-1)).toEqual({ id: "ep-1", workspaceId: WS, url: "https://erp.example/hook", secret: r.value.secret, events: ["gift.given"], active: true });
    const again = await registerEndpoint(deps, admin, WS, { url: "https://erp.example/hook", events: [] });
    expect(again.ok && again.value.secret !== r.value.secret).toBe(true);
    expect(saved.at(-1)?.events).toBe("*");
  });

  test("non-admins, non-https URLs and unknown events are refused", async () => {
    const member: Actor = { kind: "member", memberId: "ana" as MemberId, role: "approver" };
    expect(await registerEndpoint(deps, member, WS, { url: "https://x.example", events: [] })).toEqual({ ok: false, error: { code: "forbidden", need: "admin" } });
    expect(await registerEndpoint(deps, admin, WS, { url: "http://x.example", events: [] })).toEqual({ ok: false, error: { code: "invalid_field", field: "url" } });
    expect(await registerEndpoint(deps, admin, WS, { url: "https://x.example", events: ["gift.stolen"] })).toEqual({ ok: false, error: { code: "invalid_field", field: "events" } });
  });
});

describe("presentation helpers", () => {
  test("member labels and readable mentions", () => {
    expect(memberLabel("ana-torres")).toBe("Ana Torres");
    expect(memberLabel("0193f1c0-0a9b-7d4e-8f8a-1b3c5d7e9f0a")).toBe("Member 7e9f0a");
    expect(readableText("<@ana-torres> thanks <@U123|bob>")).toBe("@Ana Torres thanks @Member U123");
  });

  test("error messages for domain codes", () => {
    expect(errorMessage("en", { code: "insufficient_redeemable", cost: 12, redeemable: 5 })).toBe("Not enough redeemable balance: it costs 12, you have 5.");
    expect(errorMessage("es", { code: "insufficient_redeemable", cost: 12, redeemable: 5 })).toBe("No te alcanza el saldo canjeable: cuesta 12 y tienes 5.");
    expect(errorMessage("en", { code: "something_new" })).toBe("something new");
    expect(errorMessage("es", { code: "something_new" })).toBe("something new");
  });

  test("S80 timeframes from the query string", () => {
    expect(parseTimeframe("week", undefined, undefined)).toEqual({ kind: "week" });
    expect(parseTimeframe("custom", "2026-11-01", "2026-11-15")).toEqual({ kind: "custom", from: "2026-11-01", to: "2026-11-15" });
    expect(parseTimeframe("custom", "nope", "2026-11-15")).toEqual({ kind: "month" });
    expect(parseTimeframe(undefined, undefined, undefined)).toEqual({ kind: "month" });
  });
});
