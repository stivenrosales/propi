// i18n S3: the language a web request renders in. Framework-free so it is unit-tested; getLocale()
// (./locale.ts) feeds it the request's cookie, Accept-Language and signed-in viewer.
import { memberLocale } from "@propi/app";
import { resolveSignedOutLocale, type Directory, type Locale, type MemberId, type WorkspaceId } from "@propi/core";

export interface RequestLocaleInput {
  /** The `propi_locale` cookie the ES | EN switcher sets. */
  readonly cookie: string | null | undefined;
  readonly acceptLanguage: string | null | undefined;
  /** The signed-in member, or null on signed-out pages. */
  readonly viewer: { readonly ws: WorkspaceId; readonly memberId: MemberId } | null;
  readonly directory: Pick<Directory, "member" | "settings">;
}

/**
 * Signed in: member choice → Slack locale → workspace default → en. Signed out: cookie →
 * Accept-Language → en. A failing directory read falls back to the signed-out rules.
 */
export async function resolveRequestLocale(input: RequestLocaleInput): Promise<Locale> {
  const signedOut = resolveSignedOutLocale({ cookie: input.cookie, acceptLanguage: input.acceptLanguage });
  if (input.viewer === null) return signedOut;
  try {
    return await memberLocale(input.directory, input.viewer.ws, input.viewer.memberId);
  } catch {
    return signedOut;
  }
}
