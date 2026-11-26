"use server";
// i18n S4a-S4c: the ES | EN switcher, the workspace default language and the member's own language.
// Language settings have no ledger command (like notification preferences): they go through the db admin.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale, LOCALE_COOKIE } from "@propi/core";
import { getLocale } from "@/i18n/locale";
import { language } from "@/i18n/language.messages";
import { actionViewer, currentViewer } from "../auth";
import { finish } from "../command";
import { parseWorkspaceLanguage, saveMemberLanguage } from "../language";
import { propi } from "../propi";

const YEAR_S = 365 * 24 * 60 * 60;

async function failWith(path: string): Promise<never> {
  redirect(`${path}?error=${encodeURIComponent(language.t(await getLocale())("error.invalid"))}`);
}

/**
 * S4a: remembers the chosen language in the `propi_locale` cookie. A signed-in member's pages follow
 * their own choice (S3), so for them the click also becomes that choice.
 */
export async function setLocaleAction(form: FormData) {
  const locale = form.get("locale");
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: YEAR_S, sameSite: "lax", secure: (process.env.APP_URL ?? "").startsWith("https://") });
  const viewer = await currentViewer().catch(() => null);
  if (viewer !== null) await propi().admin.setMemberLanguage(viewer.ws, viewer.memberId, locale);
}

/** S4b: the workspace default language (admin Settings). */
export async function saveWorkspaceLanguageAction(form: FormData) {
  const v = await actionViewer("admin");
  const parsed = parseWorkspaceLanguage(form);
  if (!parsed.ok) return failWith("/admin/settings");
  await propi().admin.updateSettings(v.ws, (s) => ({ ...s, language: parsed.value }));
  finish("/admin/settings", { ok: true }, language.t(await getLocale())("settings.saved"));
}

/** S4c: the member's own language (Profile): auto, en or es. */
export async function setMemberLanguageAction(form: FormData) {
  const v = await actionViewer();
  const res = await saveMemberLanguage(propi().admin, v, form.get("language"));
  if (!res.ok) return failWith("/app/profile");
  // Read after the write: the flash is in the language just chosen.
  finish("/app/profile", { ok: true }, language.t(await getLocale())("profile.saved"));
}
