// Slack redirects here with a code. Exchange it, find the member linked to this Slack user (S107),
// and set the signed session cookie.
import { NextResponse, type NextRequest } from "next/server";
import type { WorkspaceId } from "@propi/core";
import { appUrl, sessionSecret, slackOidc } from "@/server/env";
import { propi } from "@/server/propi";
import { createSession, SESSION_COOKIE, sessionCookieOptions, verifyValue } from "@/server/session";
import { memberForSlackUser } from "@/server/signin";
import { OIDC_STATE_COOKIE, exchangeCode } from "@/server/slack-oidc";

export const dynamic = "force-dynamic";

const back = (error: string) => {
  const res = NextResponse.redirect(`${appUrl()}/signin?error=${encodeURIComponent(error)}`);
  res.cookies.delete({ name: OIDC_STATE_COOKIE, path: "/auth/slack" });
  return res;
};

export async function GET(req: NextRequest) {
  const cfg = slackOidc();
  if (cfg === null) return back("slack_not_configured");
  const url = req.nextUrl;
  if (url.searchParams.get("error")) return back("slack_denied");
  const saved = verifyValue<{ state: string; nonce: string; exp: number }>(sessionSecret(), "propi.oidc.v1", req.cookies.get(OIDC_STATE_COOKIE)?.value);
  const code = url.searchParams.get("code");
  if (saved === null || saved.exp < Date.now() || saved.state !== url.searchParams.get("state") || !code) return back("invalid_state");

  const result = await exchangeCode({ ...cfg, redirectUri: `${appUrl()}/auth/slack/callback` }, code, saved.nonce);
  if (!result.ok) return back(result.error);

  const p = propi();
  const signin = await memberForSlackUser(
    {
      workspaceOf: async (teamId) => {
        const install = await p.installations().find("slack", teamId);
        return install === null || install.uninstalledAt !== null ? null : (install.workspaceId as WorkspaceId);
      },
      resolve: (ws, ref) => p.identities.resolve(ws, ref),
      directory: p.ports.directory,
    },
    result.user,
  );
  if (!signin.ok) return back(signin.error);
  // S6: every viewer sees this member by their Slack name and picture, not just this session. Fills
  // only what is missing: the bot's users.info sync (display_name first) stays authoritative.
  const known = await p.ports.directory.member(signin.workspaceId, signin.memberId);
  const profile = { displayName: known?.displayName || result.user.name, avatarUrl: known?.avatarUrl || result.user.picture };
  if (profile.displayName !== (known?.displayName ?? null) || profile.avatarUrl !== (known?.avatarUrl ?? null)) {
    // A failed profile write never blocks sign-in.
    await p.admin.setMemberProfile(signin.workspaceId, signin.memberId, profile).catch(() => undefined);
  }

  const { value } = createSession(sessionSecret(), { ws: signin.workspaceId, member: signin.memberId, name: result.user.name, picture: result.user.picture, via: "slack" });
  const res = NextResponse.redirect(`${appUrl()}/app`);
  res.cookies.set(SESSION_COOKIE, value, sessionCookieOptions(appUrl().startsWith("https://")));
  res.cookies.delete({ name: OIDC_STATE_COOKIE, path: "/auth/slack" });
  return res;
}
