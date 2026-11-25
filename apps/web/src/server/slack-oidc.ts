// "Sign in with Slack" (OpenID Connect). Turns an authorization code into the Slack team and user,
// which the caller maps to a member through the workspace's installation and linked identities (S107).
// `fetch` is injected so the flow is unit-tested without the network.

export const SLACK_AUTHORIZE_URL = "https://slack.com/openid/connect/authorize";
export const SLACK_TOKEN_URL = "https://slack.com/api/openid.connect.token";
export const SLACK_USERINFO_URL = "https://slack.com/api/openid.connect.userInfo";
export const OIDC_STATE_COOKIE = "propi_oidc";

export interface SlackOidcConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export function authorizeUrl(cfg: Pick<SlackOidcConfig, "clientId" | "redirectUri">, state: string, nonce: string): string {
  const u = new URL(SLACK_AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid profile email");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  return u.toString();
}

export interface SlackUser {
  readonly teamId: string;
  readonly userId: string;
  readonly name: string | null;
  readonly picture: string | null;
  readonly email: string | null;
}

export type OidcResult = { readonly ok: true; readonly user: SlackUser } | { readonly ok: false; readonly error: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function decodeJwtPayload(jwt: unknown): Record<string, unknown> | null {
  if (typeof jwt !== "string") return null;
  const part = jwt.split(".")[1];
  if (part === undefined) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * Exchanges the code at Slack's token endpoint (server to server over TLS, so the id_token is
 * trusted as issued), checks the nonce and audience, then reads the user's claims.
 */
export async function exchangeCode(cfg: SlackOidcConfig, code: string, nonce: string, fetchImpl: Fetch = fetch): Promise<OidcResult> {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri, grant_type: "authorization_code" });
  const tokenRes = await fetchImpl(SLACK_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const token = (await tokenRes.json().catch(() => null)) as { ok?: boolean; error?: string; id_token?: string; access_token?: string } | null;
  if (!token?.ok || !token.access_token) return { ok: false, error: token?.error ?? "token_exchange_failed" };

  const claims = decodeJwtPayload(token.id_token);
  if (claims === null) return { ok: false, error: "invalid_id_token" };
  if (claims.nonce !== nonce) return { ok: false, error: "nonce_mismatch" };
  const aud = claims.aud;
  if (aud !== cfg.clientId && !(Array.isArray(aud) && aud.includes(cfg.clientId))) return { ok: false, error: "audience_mismatch" };

  const infoRes = await fetchImpl(SLACK_USERINFO_URL, { method: "GET", headers: { authorization: `Bearer ${token.access_token}` } });
  const info = (await infoRes.json().catch(() => null)) as Record<string, unknown> | null;
  if (info === null || info.ok !== true) return { ok: false, error: str(info?.error) ?? "userinfo_failed" };

  const teamId = str(info["https://slack.com/team_id"]) ?? str(claims["https://slack.com/team_id"]);
  const userId = str(info["https://slack.com/user_id"]) ?? str(claims["https://slack.com/user_id"]);
  if (teamId === null || userId === null) return { ok: false, error: "missing_slack_claims" };
  return { ok: true, user: { teamId, userId, name: str(info.name), picture: str(info.picture), email: str(info.email) } };
}
