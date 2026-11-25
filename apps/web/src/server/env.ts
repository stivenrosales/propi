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

/**
 * S6: Polar billing. Null (billing not configured: no plan limit, the billing page says so) unless
 * POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET and POLAR_PRO_PRODUCT_ID are all set.
 * POLAR_SERVER=production uses the live API; anything else uses the sandbox.
 */
export function polarConfig(env: Readonly<Record<string, string | undefined>> = process.env): {
  readonly accessToken: string;
  readonly webhookSecret: string;
  readonly productId: string;
  readonly apiBase: string;
} | null {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  const webhookSecret = env.POLAR_WEBHOOK_SECRET?.trim();
  const productId = env.POLAR_PRO_PRODUCT_ID?.trim();
  if (!accessToken || !webhookSecret || !productId) return null;
  const apiBase = env.POLAR_SERVER === "production" ? "https://api.polar.sh" : "https://sandbox-api.polar.sh";
  return { accessToken, webhookSecret, productId, apiBase };
}
