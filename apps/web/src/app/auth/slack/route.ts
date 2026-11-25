// Starts "Sign in with Slack" (OpenID Connect): a signed state + nonce cookie, then Slack's consent page.
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appUrl, sessionSecret, slackOidc } from "@/server/env";
import { signValue } from "@/server/session";
import { OIDC_STATE_COOKIE, authorizeUrl } from "@/server/slack-oidc";

export const dynamic = "force-dynamic";

export function GET() {
  const cfg = slackOidc();
  if (cfg === null) return NextResponse.redirect(`${appUrl()}/signin?error=slack_not_configured`);
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl({ clientId: cfg.clientId, redirectUri: `${appUrl()}/auth/slack/callback` }, state, nonce));
  res.cookies.set(OIDC_STATE_COOKIE, signValue(sessionSecret(), "propi.oidc.v1", { state, nonce, exp: Date.now() + 10 * 60_000 }), {
    httpOnly: true,
    secure: appUrl().startsWith("https://"),
    sameSite: "lax",
    path: "/auth/slack",
    maxAge: 600,
  });
  return res;
}
