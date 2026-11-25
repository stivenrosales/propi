// Server configuration from environment variables. Secrets are read here and nowhere else; they are
// never logged (describeConfig prints which are set, not their values). Every variable is documented
// in deploy/propi.env.example.

export interface SlackConfig {
  readonly botToken: string;
  /** Socket Mode (default): needs the app-level token, no public URL. */
  readonly mode: "socket" | "http";
  readonly appToken: string | null;
  readonly signingSecret: string | null;
  /** S5: the Slack user who installed the app; becomes the first admin of a new workspace. */
  readonly installerUserId: string | null;
}

export interface ServerConfig {
  readonly databaseUrl: string;
  /**
   * null when SLACK_BOT_TOKEN is unset: the Slack app is created and its tokens entered after the
   * first deploy, so the server then runs health only (/healthz) instead of crash-looping.
   */
  readonly slack: SlackConfig | null;
  /** HTTP port for /healthz (and /slack/events in HTTP mode). */
  readonly port: number;
  /** Public web app URL, linked from the App Home and reports. */
  readonly appUrl: string | null;
  /** Workspace timezone for a new install (S3). */
  readonly timezone: string;
  readonly openRouter: { readonly apiKey: string; readonly model: string } | null;
  /** Disables the minute scheduler (e.g. a second replica that only serves Slack). */
  readonly schedulerEnabled: boolean;
  /** How often the outbox relay polls (ms). */
  readonly relayIntervalMs: number;
}

export class ConfigError extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

const val = (env: Env, name: string): string | null => {
  const v = env[name]?.trim();
  return v === undefined || v === "" ? null : v;
};

function need(env: Env, name: string, why: string): string {
  const v = val(env, name);
  if (v === null) throw new ConfigError(`${name} is required (${why})`);
  return v;
}

function int(env: Env, name: string, fallback: number): number {
  const v = val(env, name);
  if (v === null) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ConfigError(`${name} must be a positive integer`);
  return n;
}

/**
 * Slack is off (null) without SLACK_BOT_TOKEN. With it: Socket Mode unless SLACK_SOCKET_MODE=false,
 * which needs SLACK_SIGNING_SECRET for HTTP mode.
 */
function loadSlack(env: Env): SlackConfig | null {
  const socketFlag = val(env, "SLACK_SOCKET_MODE")?.toLowerCase();
  if (socketFlag !== undefined && socketFlag !== "true" && socketFlag !== "false") throw new ConfigError("SLACK_SOCKET_MODE must be true or false");
  const botToken = val(env, "SLACK_BOT_TOKEN");
  if (botToken === null) return null;
  const mode = socketFlag === "false" ? "http" : "socket";
  return {
    botToken,
    mode,
    appToken: mode === "socket" ? need(env, "SLACK_APP_TOKEN", "Socket Mode app-level token xapp-…") : val(env, "SLACK_APP_TOKEN"),
    signingSecret: mode === "http" ? need(env, "SLACK_SIGNING_SECRET", "HTTP mode verifies Slack signatures") : val(env, "SLACK_SIGNING_SECRET"),
    installerUserId: val(env, "SLACK_INSTALLER_USER_ID"),
  };
}

export function loadConfig(env: Env): ServerConfig {
  const key = val(env, "OPENROUTER_API_KEY");
  return {
    databaseUrl: need(env, "DATABASE_URL", "Postgres connection string"),
    slack: loadSlack(env),
    port: int(env, "PORT", 3001),
    appUrl: val(env, "APP_URL")?.replace(/\/+$/, "") ?? null,
    timezone: val(env, "PROPI_TIMEZONE") ?? "UTC",
    openRouter: key === null ? null : { apiKey: key, model: val(env, "OPENROUTER_MODEL") ?? "openai/gpt-4o-mini" },
    schedulerEnabled: val(env, "PROPI_SCHEDULER")?.toLowerCase() !== "false",
    relayIntervalMs: int(env, "PROPI_RELAY_INTERVAL_MS", 2000),
  };
}

/** A log line that says what is configured without printing any secret. */
export function describeConfig(c: ServerConfig): Record<string, unknown> {
  return {
    slackMode: c.slack === null ? "not_configured" : c.slack.mode,
    port: c.port,
    appUrl: c.appUrl,
    timezone: c.timezone,
    installerConfigured: c.slack?.installerUserId != null,
    digest: c.openRouter === null ? "off (OPENROUTER_API_KEY unset)" : `on (${c.openRouter.model})`,
    scheduler: c.schedulerEnabled,
  };
}
