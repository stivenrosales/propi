import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "../../../server/env.ts";
import { SESSION_COOKIE } from "../../../server/session.ts";

export const dynamic = "force-dynamic";

// Built from APP_URL: behind the proxy req.url carries the bind address (0.0.0.0:3000).
export function GET(_req: NextRequest) {
  const res = NextResponse.redirect(`${appUrl()}/signin`, 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
