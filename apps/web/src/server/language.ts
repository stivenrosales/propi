// i18n S4b, S4c: the workspace default language (admin Settings) and the member's own language
// (Profile). Framework-free so it is unit-tested; the server actions only add auth and the redirect.
import { isLocale, parseLanguageChoice, type LanguageChoice, type Locale, type MemberId, type WorkspaceId } from "@propi/core";
import type { DbAdmin } from "@propi/db";

type Invalid = { readonly ok: false; readonly error: { readonly code: "invalid_field"; readonly field: "language" } };
const invalid: Invalid = { ok: false, error: { code: "invalid_field", field: "language" } };

/** S4b: the admin Settings "Language" select: en or es. */
export function parseWorkspaceLanguage(form: FormData): { readonly ok: true; readonly value: Locale } | Invalid {
  const v = String(form.get("language") ?? "").trim();
  return isLocale(v) ? { ok: true, value: v } : invalid;
}

/** S4c: stores the viewer's own language ("auto" follows Slack, then the workspace default). */
export async function saveMemberLanguage(
  admin: Pick<DbAdmin, "setMemberLanguage">,
  viewer: { readonly ws: WorkspaceId; readonly memberId: MemberId },
  raw: unknown,
): Promise<{ readonly ok: true; readonly value: LanguageChoice } | Invalid> {
  const choice = parseLanguageChoice(raw);
  if (choice === null) return invalid;
  await admin.setMemberLanguage(viewer.ws, viewer.memberId, choice);
  return { ok: true, value: choice };
}
