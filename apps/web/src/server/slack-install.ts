// S2 "Add to Slack" (OAuth v2). A signed, short-lived `state` in an httpOnly cookie ties the callback
// to the browser that started the install. The callback exchanges the code at oauth.v2.access, stores
// the bot token encrypted in the installation (installations.bootstrap: first install creates the
// workspace with the installer as first admin; a reinstall refreshes the token and never changes roles).
// Framework-free, with `fetch` injected, so the flow is unit-tested without the network.
import { randomBytes } from "node:crypto";
import type { Instant, WorkspaceId } from "@propi/core";
import type { DbInstallations, SlackInstallationData } from "@propi/db";
import { signValue, verifyValue } from "./session";

export const SLACK_INSTALL_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";
export const SLACK_USERS_INFO_URL = "https://slack.com/api/users.info";
export const INSTALL_STATE_COOKIE = "propi_slack_install";
export const INSTALL_CALLBACK_PATH = "/slack/oauth/callback";
const STATE_PURPOSE = "propi.slack-install.v1";
const STATE_TTL_MS = 10 * 60_000;

/** The bot scopes of deploy/slack-manifest.yml (a test keeps them in step). */
export const BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "chat:write",
  "commands",
  "emoji:read",
  "im:history",
  "im:write",
  "mpim:write",
  "reactions:read",
  "team:read",
  "usergroups:read",
  "users:read",
  "users:read.email",
] as const;

export interface SlackInstallConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export function installUrl(cfg: Pick<SlackInstallConfig, "clientId" | "redirectUri">, state: string): string {
  const u = new URL(SLACK_INSTALL_URL);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("scope", BOT_SCOPES.join(","));
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

/** A fresh state and the signed cookie value that carries it. */
export function newInstallState(secret: string, nowMs: number = Date.now()): { readonly state: string; readonly cookie: string } {
  const state = randomBytes(16).toString("base64url");
  return { state, cookie: signValue(secret, STATE_PURPOSE, { state, exp: nowMs + STATE_TTL_MS }) };
}

/** True only for an unexpired cookie signed by us whose state equals the one Slack sent back. */
export function checkInstallState(secret: string, cookie: string | undefined | null, given: string | null, nowMs: number = Date.now()): boolean {
  const saved = verifyValue<{ state?: unknown; exp?: unknown }>(secret, STATE_PURPOSE, cookie);
  return saved !== null && typeof saved.state === "string" && typeof saved.exp === "number" && saved.exp >= nowMs && given !== null && saved.state === given;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type InstallExchange = { readonly ok: true; readonly installation: SlackInstallationData } | { readonly ok: false; readonly error: string };

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** oauth.v2.access: the bot token, bot user, team and the installing user. */
export async function exchangeInstallCode(cfg: SlackInstallConfig, code: string, fetchImpl: Fetch = fetch): Promise<InstallExchange> {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri });
  const res = await fetchImpl(SLACK_OAUTH_ACCESS_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const r = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (r === null || r.ok !== true) return { ok: false, error: str(r?.error) ?? "oauth_failed" };
  const team = (r.team ?? {}) as Record<string, unknown>;
  const user = (r.authed_user ?? {}) as Record<string, unknown>;
  const teamId = str(team.id);
  const botToken = str(r.access_token);
  const botUserId = str(r.bot_user_id);
  const installerUserId = str(user.id);
  if (r.token_type !== "bot" || teamId === null || botToken === null || botUserId === null || installerUserId === null) return { ok: false, error: "incomplete_install" };
  const scopes = (str(r.scope) ?? "").split(",").filter((s) => s !== "");
  return { ok: true, installation: { teamId, teamName: str(team.name), botToken, botUserId, scopes, installerUserId } };
}

/** S3: the installer's Slack timezone (users.info `tz`), or null when Slack does not say. */
export async function installerTimezone(botToken: string, userId: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${SLACK_USERS_INFO_URL}?user=${encodeURIComponent(userId)}`, { method: "GET", headers: { authorization: `Bearer ${botToken}` } });
    const r = (await res.json().catch(() => null)) as { ok?: boolean; user?: { tz?: unknown } } | null;
    return r?.ok === true ? str(r.user?.tz) : null;
  } catch {
    return null;
  }
}

export interface CompleteInstallDeps {
  readonly installations: Pick<DbInstallations, "bootstrap">;
  /** PROPI_TIMEZONE, or a default, when the installer's Slack profile has no timezone. */
  readonly fallbackTimezone: string;
  readonly now: () => number;
  readonly fetch?: Fetch;
}

/** S2: exchange the code and store the installation; the installer becomes first admin of a new workspace (S5). */
export async function completeInstall(
  deps: CompleteInstallDeps,
  cfg: SlackInstallConfig,
  code: string,
): Promise<{ readonly ok: true; readonly workspaceId: WorkspaceId; readonly created: boolean } | { readonly ok: false; readonly error: string }> {
  const ex = await exchangeInstallCode(cfg, code, deps.fetch);
  if (!ex.ok) return ex;
  const inst = ex.installation;
  const timezone = (await installerTimezone(inst.botToken, inst.installerUserId ?? "", deps.fetch)) ?? deps.fallbackTimezone;
  const r = await deps.installations.bootstrap({
    platform: "slack",
    tenantId: inst.teamId,
    installerUserId: inst.installerUserId ?? "",
    at: deps.now() as Instant,
    settings: { timezone },
    installation: inst,
  });
  return { ok: true, workspaceId: r.workspaceId, created: r.created };
}
