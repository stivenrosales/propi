// S2 "Add to Slack": a signed state in an httpOnly cookie, then Slack's OAuth v2 install page.
import { NextResponse } from "next/server";
import { appUrl, sessionSecret, slackOidc } from "@/server/env";
import { INSTALL_CALLBACK_PATH, INSTALL_STATE_COOKIE, installUrl, newInstallState } from "@/server/slack-install";

export const dynamic = "force-dynamic";

export function GET() {
  const cfg = slackOidc();
  if (cfg === null) return NextResponse.redirect(`${appUrl()}/signin?error=slack_not_configured`);
  const { state, cookie } = newInstallState(sessionSecret());
  const res = NextResponse.redirect(installUrl({ clientId: cfg.clientId, redirectUri: `${appUrl()}${INSTALL_CALLBACK_PATH}` }, state));
  res.cookies.set(INSTALL_STATE_COOKIE, cookie, { httpOnly: true, secure: appUrl().startsWith("https://"), sameSite: "lax", path: "/slack", maxAge: 600 });
  return res;
}
