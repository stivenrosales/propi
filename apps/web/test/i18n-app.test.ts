// i18n T3 (S1, S2, S4): the signed-in web app (member and admin pages, app frame, shared components,
// error texts, action confirmations) reads in English and in Spanish, with locale-aware dates.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { errorMessage, formatDate, formatMoney, memberLabel } from "../src/lib/format.ts";
import { shell, stateName } from "../src/i18n/app-shell.messages.ts";
import { shop } from "../src/i18n/shop.messages.ts";
import { home } from "../src/i18n/app-home.messages.ts";
import { settingsPage } from "../src/i18n/admin-settings.messages.ts";
import { billingPage } from "../src/i18n/admin-billing.messages.ts";
import { actions } from "../src/i18n/actions.messages.ts";

describe("error texts (lib/format.ts) in both languages", () => {
  test("role-gated, field and lookup errors", () => {
    expect(errorMessage("en", { code: "forbidden", need: "admin" })).toBe("You need the admin role for that.");
    expect(errorMessage("es", { code: "forbidden", need: "approver" })).toBe("Necesitas el rol de aprobador para eso.");
    expect(errorMessage("en", { code: "invalid_field", field: "timezone" })).toBe('Please check the field "timezone".');
    expect(errorMessage("es", { code: "invalid_field", field: "timezone" })).toBe('Revisa el campo "zona horaria".');
    expect(errorMessage("es", { code: "invalid_field", field: "hashtag of Coraje" })).toBe('Revisa el campo "hashtag de Coraje".');
    expect(errorMessage("es", { code: "invalid_field", field: "somethingElse" })).toBe('Revisa el campo "somethingElse".');
    expect(errorMessage("en", { code: "not_found", what: "endpoint" })).toBe("Not found: endpoint.");
    expect(errorMessage("es", { code: "not_found", what: "endpoint" })).toBe("No encontramos: el endpoint.");
    expect(errorMessage("es", { code: "avatar_locked", minLevel: 4 })).toBe("Ese avatar se desbloquea en el nivel 4.");
    expect(errorMessage("es", { code: "illegal_transition" })).toBe("Ese elemento ya no puede pasar a ese estado.");
    expect(errorMessage("es", { code: "plan_limit" })).toBe("Tu espacio de trabajo superó el límite del plan Free. Pídele a un admin que pase a Pro.");
  });

  test("every coded error has a Spanish text that differs from the English one", () => {
    const codes = ["forbidden", "insufficient_redeemable", "out_of_stock", "invalid_quantity", "plan_limit", "billing_not_configured", "billing_unavailable", "already_subscribed", "budget_exceeded", "reason_required", "invalid_amount", "idempotency_key_reused", "invalid_transition", "invalid_reward", "quest_not_open", "proof_required", "cooldown", "cap_reached", "collab_closed", "avatar_locked", "module_disabled", "reward_not_active", "unknown_member", "invalid_field", "invalid_currency", "not_found"];
    for (const code of codes) {
      const e = { code, need: "admin", cost: 3, redeemable: 1, minLevel: 2, field: "x", what: "endpoint" };
      expect(errorMessage("es", e), code).not.toBe(errorMessage("en", e));
      expect(errorMessage("es", e), code).not.toContain("_");
    }
  });

  test("member fallback label, dates and money follow the locale", () => {
    expect(memberLabel("0193f1c0-0a9b-7d4e-8f8a-1b3c5d7e9f0a", "es")).toBe("Miembro 7e9f0a");
    const at = Date.UTC(2026, 10, 25, 15, 30);
    expect(formatDate("en", at, "UTC")).toBe("Nov 25, 2026");
    expect(formatDate("es", at, "UTC")).toBe("25 nov 2026");
    expect(formatDate("es", at, "America/Lima", true)).toMatch(/^25 nov 2026, 10:30/);
    expect(formatMoney("en", 1250, "USD")).toBe("$12.50");
    expect(formatMoney("es", 1250, "PEN")).toMatch(/12\.50/);
  });
});

describe("representative surfaces resolve in both languages", () => {
  test("app frame: navigation, roles and lifecycle states", () => {
    expect(shell.t("en")("nav.app.shop")).toBe("Shop");
    expect(shell.t("es")("nav.app.shop")).toBe("Tienda");
    expect(shell.t("es")("nav.admin.settings")).toBe("Configuración");
    expect(shell.t("es")("role.approver")).toBe("Aprobador");
    expect(stateName(shell.t("en"), "pending")).toBe("Pending");
    expect(stateName(shell.t("es"), "pending")).toBe("Pendiente");
    expect(stateName(shell.t("es"), "mystery")).toBe("Mystery");
    expect(shell.t("es")("plan.overDetail", { active: 7, limit: 5 })).toBe("(7 de 5 miembros activos). La tienda de recompensas no acepta canjes nuevos hasta que pases a Pro.");
  });

  test("member home and shop (quantity stepper)", () => {
    expect(home.t("en")("hi", { name: "Ana" })).toBe("Hi Ana!");
    expect(home.t("es")("hi", { name: "Ana" })).toBe("¡Hola, Ana!");
    expect(home.t("es")("historyEmptyBody", { emoji: ":taco:" })).toBe("Da tu primer reconocimiento en Slack con :taco:.");
    expect(shop.t("en")("redeemMany", { count: 3 })).toBe("Redeem 3");
    expect(shop.t("es")("redeemMany", { count: 3 })).toBe("Canjear 3");
    expect(shop.t("es")("need", { count: 1200 })).toBe("Te faltan 1,200");
    expect(shop.t("es")("confirm", { total: 36 })).toBe("¿Usar 36? Toca otra vez");
  });

  test("admin settings, billing and action confirmations", () => {
    expect(settingsPage.t("es")("title")).toBe("Configuración");
    expect(billingPage.t("en")("seats", { count: 1 })).toBe("1 paid seat");
    expect(billingPage.t("es")("seats", { count: 12 })).toBe("12 puestos pagados");
    expect(actions.t("en")("redeemed", { state: "pending" })).toBe("Redeemed! Your redemption is pending.");
    expect(actions.t("es")("redeemed", { state: stateName(shell.t("es"), "pending").toLowerCase() })).toBe("¡Canjeado! Tu canje está pendiente.");
  });
});

// S1: no user-facing English literal is left in the signed-in pages and their shared components.
// Literals that are codes, URLs or brand names (PEN, C0123456, https://…, Propi) are allowed.
describe("no hard-coded English in the signed-in web app (S1)", () => {
  const src = fileURLToPath(new URL("../src/", import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(f) ? [p] : [];
    });
  const scope = ["app/(app)", "app/(admin)", "app/tv", "components/app", "components/ui"].flatMap((d) => files(join(src, d)));
  const ALLOWED = new Set(["Propi", "PEN", "C0123456", "N / K / P", "URL", "CSV", "Promise"]);

  test.each(scope.map((f) => [relative(src, f), f]))("%s", (_name, file) => {
    const code = readFileSync(file, "utf8");
    const attrs = [...code.matchAll(/\b(label|title|placeholder|aria-label|confirm|hint|eyebrow|submit|note|alt)="([^"]*[A-Za-z][^"]*)"/g)]
      .map((m) => m[2]!)
      .filter((v) => !ALLOWED.has(v) && !v.startsWith("https://"));
    expect(attrs).toEqual([]);
    // Text nodes: words between tags on one line, or a line holding only words (a wrapped text node).
    const inline = [...code.matchAll(/>[ \t]*([A-Z][A-Za-z ,.'!?-]{2,}?)[ \t]*</g)].map((m) => m[1]!).filter((v) => !ALLOWED.has(v));
    const lines = code.split("\n").filter((l) => /^\s+[A-Z][a-z]+(?: [A-Za-z']+)+[.!]?\s*$/.test(l)).map((l) => l.trim());
    expect([...inline, ...lines]).toEqual([]);
  });
});
