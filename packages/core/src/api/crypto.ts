// The Crypto port (S98, S99). Core declares it; packages/app implements it with node:crypto.
// Core functions receive it as a parameter, so core itself never touches a runtime crypto API.

export interface Crypto {
  /** HMAC-SHA256 of `message` keyed with `secret` (both UTF-8), lowercase hex. */
  hmacSha256Hex(secret: string, message: string): string;
  /** SHA-256 of `text` (UTF-8), lowercase hex. */
  sha256Hex(text: string): string;
  /** `bytes` random bytes, base64url without padding. */
  randomToken(bytes: number): string;
}

/** Equality that does not stop at the first different character, for secrets and signatures. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
