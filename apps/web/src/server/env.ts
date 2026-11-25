// Environment for the web process. Secrets come only from environment variables (`deploy/propi.env.example`).

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") throw new Error(`${name} is not set (see deploy/propi.env.example)`);
  return v;
}

export const databaseUrl = (): string => required("DATABASE_URL");

/** Signs session cookies and TV display tokens. At least 32 characters. */
export function sessionSecret(): string {
  const s = required("SESSION_SECRET");
  if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return s;
}

/** Public base URL of the web app, e.g. https://propi.example.com (no trailing slash). */
export const appUrl = (): string => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export function slackOidc(): { readonly clientId: string; readonly clientSecret: string } | null {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** The dev-only login: never in production, and only when explicitly turned on. */
export const devLoginEnabled = (env: Readonly<Record<string, string | undefined>> = process.env): boolean =>
  env.NODE_ENV !== "production" && env.PROPI_DEV_LOGIN === "true";
