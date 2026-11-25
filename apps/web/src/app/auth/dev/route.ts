// Dev-only sign in as any member: refused unless NODE_ENV !== "production" and PROPI_DEV_LOGIN=true.
import { NextResponse, type NextRequest } from "next/server";
import type { MemberId, WorkspaceId } from "@propi/core";
import { devLoginEnabled, sessionSecret } from "@/server/env";
import { propi } from "@/server/propi";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/server/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!devLoginEnabled()) return new NextResponse("Not found", { status: 404 });
  const form = await req.formData();
  const [ws = "", member = ""] = String(form.get("member") ?? "").split("::") as [WorkspaceId?, MemberId?];
  const record = await propi().ports.directory.member(ws as WorkspaceId, member as MemberId);
  if (record === null || !record.active) return NextResponse.redirect(new URL("/signin?error=identity_not_linked", req.url), 303);
  const { value } = createSession(sessionSecret(), { ws, member, name: null, picture: null, via: "dev" });
  const next = String(form.get("next") ?? "");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app"; // same-site paths only
  const res = NextResponse.redirect(new URL(safeNext, req.url), 303);
  res.cookies.set(SESSION_COOKIE, value, sessionCookieOptions(false));
  return res;
}
