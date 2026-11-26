// i18n S3: getLocale() for server components, route handlers and server actions. Once per request
// (React cache). Pages translate with a catalog: `const t = language.t(await getLocale())`.
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, type Locale, type MemberId, type WorkspaceId } from "@propi/core";
import { sessionSecret } from "@/server/env";
import { propi } from "@/server/propi";
import { readSession, SESSION_COOKIE } from "@/server/session";
import { resolveRequestLocale, type RequestLocaleInput } from "./resolve";

/** The signed-in member from the session cookie (signature and expiry only; no session → null). */
function sessionMember(value: string | undefined): { ws: WorkspaceId; memberId: MemberId } | null {
  if (!value) return null;
  try {
    const s = readSession(sessionSecret(), value);
    return s === null ? null : { ws: s.ws as WorkspaceId, memberId: s.member as MemberId };
  } catch {
    return null;
  }
}

const SIGNED_OUT: RequestLocaleInput["directory"] = {
  member: async () => null,
  settings: async () => Promise.reject(new Error("signed out: no workspace")),
};

export const getLocale = cache(async (): Promise<Locale> => {
  // Outside any try: cookies()/headers() signal dynamic rendering to Next and must not be swallowed.
  const [store, h] = await Promise.all([cookies(), headers()]);
  const viewer = sessionMember(store.get(SESSION_COOKIE)?.value);
  return resolveRequestLocale({
    cookie: store.get(LOCALE_COOKIE)?.value,
    acceptLanguage: h.get("accept-language"),
    viewer,
    // Signed out, the directory is never read: no database connection for the landing page.
    directory: viewer === null ? SIGNED_OUT : propi().ports.directory,
  });
});
