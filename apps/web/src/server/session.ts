// Signed session cookie: `<base64url(json)>.<base64url(hmac-sha256)>`. The cookie names who signed in
// (workspace + member); the role is always re-read from the directory on each request, so a role
// change or a deactivation takes effect immediately (S5, S7). Framework-free so it is unit-tested.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "propi_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

export interface Session {
  readonly ws: string;
  readonly member: string;
  /** Display name and picture from the identity provider, when known. */
  readonly name: string | null;
  readonly picture: string | null;
  /** How the session was created. */
  readonly via: "slack" | "dev";
  /** Expiry, epoch seconds. */
  readonly exp: number;
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

/** Signs any JSON value with a purpose label, so a token for one purpose never verifies for another. */
export function signValue(secret: string, purpose: string, value: unknown): string {
  const payload = b64(JSON.stringify(value));
  const sig = createHmac("sha256", secret).update(`${purpose}.${payload}`).digest();
  return `${payload}.${b64(sig)}`;
}

export function verifyValue<T>(secret: string, purpose: string, token: string | undefined | null): T | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = createHmac("sha256", secret).update(`${purpose}.${payload}`).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

const SESSION_PURPOSE = "propi.session.v1";

export function createSession(secret: string, s: Omit<Session, "exp">, nowMs: number = Date.now()): { readonly value: string; readonly session: Session } {
  const session: Session = { ...s, exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS };
  return { value: signValue(secret, SESSION_PURPOSE, session), session };
}

export function readSession(secret: string, cookie: string | undefined | null, nowMs: number = Date.now()): Session | null {
  const s = verifyValue<Partial<Session>>(secret, SESSION_PURPOSE, cookie);
  if (s === null || typeof s.ws !== "string" || typeof s.member !== "string" || typeof s.exp !== "number") return null;
  if (s.exp * 1000 <= nowMs) return null;
  return { ws: s.ws, member: s.member, name: s.name ?? null, picture: s.picture ?? null, via: s.via === "slack" ? "slack" : "dev", exp: s.exp };
}

export const sessionCookieOptions = (secure: boolean) =>
  ({ httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS }) as const;
