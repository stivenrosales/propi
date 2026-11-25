// Auth and session: the signed httpOnly session cookie, the dev-login switch, TV display tokens and the
// Slack sign-in mapping to a member through linked identities (S107).
import { describe, expect, test } from "vitest";
import type { Directory, IdentityRef, MemberId, MemberRecord, WorkspaceId } from "@propi/core";
import { createSession, readSession, sessionCookieOptions, SESSION_TTL_SECONDS, signValue, verifyValue } from "../src/server/session.ts";
import { devLoginEnabled } from "../src/server/env.ts";
import { tvToken, workspaceOfTvToken } from "../src/server/tv-token.ts";
import { memberForSlackUser } from "../src/server/signin.ts";
import { authorizeUrl, exchangeCode } from "../src/server/slack-oidc.ts";

const SECRET = "test-secret-0123456789abcdef0123456789";
const NOW = Date.UTC(2026, 10, 25, 15);

describe("session cookie", () => {
  const base = { ws: "ws-1", member: "ana", name: "Ana", picture: null, via: "slack" as const };

  test("round-trips a signed session until it expires", () => {
    const { value } = createSession(SECRET, base, NOW);
    expect(readSession(SECRET, value, NOW)).toMatchObject({ ws: "ws-1", member: "ana", name: "Ana", via: "slack" });
    expect(readSession(SECRET, value, NOW + (SESSION_TTL_SECONDS - 1) * 1000)).not.toBeNull();
    expect(readSession(SECRET, value, NOW + SESSION_TTL_SECONDS * 1000)).toBeNull();
  });

  test("a tampered payload, a forged signature or another secret is refused", () => {
    const { value } = createSession(SECRET, base, NOW);
    const [payload, sig] = value.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...base, member: "boss", exp: NOW / 1000 + 999 })).toString("base64url");
    expect(readSession(SECRET, `${forged}.${sig}`, NOW)).toBeNull();
    expect(readSession(SECRET, `${payload}.${sig.slice(0, -2)}AA`, NOW)).toBeNull();
    expect(readSession("another-secret-0123456789abcdef012345", value, NOW)).toBeNull();
    expect(readSession(SECRET, "garbage", NOW)).toBeNull();
    expect(readSession(SECRET, undefined, NOW)).toBeNull();
  });

  test("the cookie is httpOnly, SameSite=Lax and secure behind https", () => {
    expect(sessionCookieOptions(true)).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(sessionCookieOptions(false).secure).toBe(false);
  });

  test("a value signed for one purpose never verifies for another", () => {
    const t = signValue(SECRET, "propi.tv.v1", { ws: "ws-1" });
    expect(verifyValue(SECRET, "propi.tv.v1", t)).toEqual({ ws: "ws-1" });
    expect(verifyValue(SECRET, "propi.session.v1", t)).toBeNull();
  });
});

describe("dev login", () => {
  test("only when NODE_ENV is not production and PROPI_DEV_LOGIN=true", () => {
    expect(devLoginEnabled({ NODE_ENV: "development", PROPI_DEV_LOGIN: "true" })).toBe(true);
    expect(devLoginEnabled({ NODE_ENV: "production", PROPI_DEV_LOGIN: "true" })).toBe(false);
    expect(devLoginEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devLoginEnabled({ NODE_ENV: "development", PROPI_DEV_LOGIN: "1" })).toBe(false);
  });
});

describe("S87 TV display token", () => {
  test("names its workspace and cannot be forged or used as a session", () => {
    const t = tvToken(SECRET, "ws-1");
    expect(workspaceOfTvToken(SECRET, t)).toBe("ws-1");
    expect(workspaceOfTvToken(SECRET, t.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    expect(workspaceOfTvToken("other-secret-0123456789abcdef0123456", t)).toBeNull();
    expect(readSession(SECRET, t, NOW)).toBeNull();
    expect(workspaceOfTvToken(SECRET, undefined)).toBeNull();
  });
});

describe("S107 Slack sign-in maps a Slack user to a member through identities", () => {
  const WS = "ws-1" as WorkspaceId;
  const members = new Map<string, MemberRecord>([
    ["ana", { id: "ana" as MemberId, role: "member", active: true, dailyLimitOverride: null }],
    ["gone", { id: "gone" as MemberId, role: "member", active: false, dailyLimitOverride: null }],
  ]);
  const links = new Map<string, MemberId>([
    ["T1:U-ana", "ana" as MemberId],
    ["T1:U-ana-teams", "ana" as MemberId],
    ["T1:U-gone", "gone" as MemberId],
  ]);
  const deps = {
    workspaceOf: async (team: string) => (team === "T1" ? WS : null),
    resolve: async (_ws: WorkspaceId, ref: IdentityRef) => links.get(`${ref.tenantId}:${ref.userId}`) ?? null,
    directory: { member: async (_ws: WorkspaceId, id: MemberId) => members.get(id) ?? null } as Pick<Directory, "member">,
  };

  test("a linked identity signs in as its member; two identities share one member", async () => {
    expect(await memberForSlackUser(deps, { teamId: "T1", userId: "U-ana" })).toEqual({ ok: true, workspaceId: WS, memberId: "ana" });
    expect(await memberForSlackUser(deps, { teamId: "T1", userId: "U-ana-teams" })).toEqual({ ok: true, workspaceId: WS, memberId: "ana" });
  });

  test("an unknown team, an unlinked user or a deactivated member (S7) is refused", async () => {
    expect(await memberForSlackUser(deps, { teamId: "T9", userId: "U-ana" })).toEqual({ ok: false, error: "workspace_not_installed" });
    expect(await memberForSlackUser(deps, { teamId: "T1", userId: "U-nobody" })).toEqual({ ok: false, error: "identity_not_linked" });
    expect(await memberForSlackUser(deps, { teamId: "T1", userId: "U-gone" })).toEqual({ ok: false, error: "inactive_member" });
  });
});

describe("Slack OpenID Connect", () => {
  const cfg = { clientId: "123.456", clientSecret: "shh", redirectUri: "https://propi.test/auth/slack/callback" };
  const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  const fake = (token: object, info: object) => async (url: string) =>
    new Response(JSON.stringify(url.includes("openid.connect.token") ? token : info), { headers: { "content-type": "application/json" } });

  test("the authorize URL asks for openid profile email with state and nonce", () => {
    const u = new URL(authorizeUrl(cfg, "st", "no"));
    expect(u.origin + u.pathname).toBe("https://slack.com/openid/connect/authorize");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: "code", scope: "openid profile email", client_id: "123.456", redirect_uri: cfg.redirectUri, state: "st", nonce: "no" });
  });

  test("a code becomes the Slack team and user", async () => {
    const r = await exchangeCode(
      cfg,
      "code",
      "n1",
      fake({ ok: true, access_token: "xoxp", id_token: idToken({ nonce: "n1", aud: "123.456" }) }, { ok: true, "https://slack.com/team_id": "T1", "https://slack.com/user_id": "U1", name: "Ana", picture: "https://img" }),
    );
    expect(r).toEqual({ ok: true, user: { teamId: "T1", userId: "U1", name: "Ana", picture: "https://img", email: null } });
  });

  test("a wrong nonce, a wrong audience or a failed exchange is refused", async () => {
    const info = { ok: true, "https://slack.com/team_id": "T1", "https://slack.com/user_id": "U1" };
    expect(await exchangeCode(cfg, "c", "n1", fake({ ok: true, access_token: "x", id_token: idToken({ nonce: "other", aud: "123.456" }) }, info))).toEqual({ ok: false, error: "nonce_mismatch" });
    expect(await exchangeCode(cfg, "c", "n1", fake({ ok: true, access_token: "x", id_token: idToken({ nonce: "n1", aud: "evil" }) }, info))).toEqual({ ok: false, error: "audience_mismatch" });
    expect(await exchangeCode(cfg, "c", "n1", fake({ ok: false, error: "invalid_code" }, info))).toEqual({ ok: false, error: "invalid_code" });
  });
});
