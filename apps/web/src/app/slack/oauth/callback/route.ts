// S2: Slack redirects here after "Add to Slack". Check the state, exchange the code, store the bot
// token encrypted in the installation (installer = first admin of a new workspace, S5), then sign in.
import { NextResponse, type NextRequest } from "next/server";
import { appUrl, sessionSecret, slackOidc } from "@/server/env";
import { propi } from "@/server/propi";
import { INSTALL_CALLBACK_PATH, INSTALL_STATE_COOKIE, checkInstallState, completeInstall } from "@/server/slack-install";

export const dynamic = "force-dynamic";

const to = (path: string) => {
  const res = NextResponse.redirect(`${appUrl()}${path}`);
  res.cookies.delete({ name: INSTALL_STATE_COOKIE, path: "/slack" });
  return res;
};

export async function GET(req: NextRequest) {
  const cfg = slackOidc();
  if (cfg === null) return to("/signin?error=slack_not_configured");
  const url = req.nextUrl;
  if (url.searchParams.get("error")) return to("/signin?error=install_cancelled");
  const code = url.searchParams.get("code");
  if (!code || !checkInstallState(sessionSecret(), req.cookies.get(INSTALL_STATE_COOKIE)?.value, url.searchParams.get("state"))) return to("/signin?error=invalid_state");

  const r = await completeInstall(
    { installations: propi().installations(), fallbackTimezone: process.env.PROPI_TIMEZONE?.trim() || "UTC", now: Date.now },
    { ...cfg, redirectUri: `${appUrl()}${INSTALL_CALLBACK_PATH}` },
    code,
  );
  if (!r.ok) return to(`/signin?error=${encodeURIComponent(r.error === "invalid_code" ? "invalid_state" : "install_failed")}`);
  return to("/signin?installed=1");
}
