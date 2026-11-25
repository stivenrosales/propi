// Secrets at rest (architecture §8: ENCRYPTION_KEY encrypts webhook secrets and Slack tokens).
// AES-256-GCM with a random 96-bit IV per value. The stored form is
//   v1.<iv base64url>.<tag base64url>.<ciphertext base64url>
// and every value is bound to its row with associated data (e.g. "webhook:<ws>:<id>"), so a
// ciphertext copied into another row fails to decrypt instead of leaking a secret there.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SecretCipher {
  encrypt(plaintext: string, context: string): string;
  /** Throws when the key, the context or the ciphertext does not match. */
  decrypt(stored: string, context: string): string;
}

const VERSION = "v1";
const IV_BYTES = 12;

/**
 * The 32-byte key from its text form: 64 hex characters, or base64/base64url of 32 bytes.
 * Generate one with `openssl rand -base64 32`.
 */
export function parseEncryptionKey(text: string): Buffer {
  const t = text.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(t) ? Buffer.from(t, "hex") : Buffer.from(t, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes: 64 hex characters or base64 of 32 bytes");
  return key;
}

export function createSecretCipher(keyText: string): SecretCipher {
  const key = parseEncryptionKey(keyText);
  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    },
    decrypt(stored, context) {
      const [version, iv, tag, ct, ...rest] = stored.split(".");
      if (version !== VERSION || iv === undefined || tag === undefined || ct === undefined || rest.length > 0) throw new Error("unrecognized encrypted value");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}

/** The cipher from `ENCRYPTION_KEY`; throws when it is missing or malformed. */
export function secretCipherFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): SecretCipher {
  const key = env["ENCRYPTION_KEY"];
  if (key === undefined || key.trim() === "") throw new Error("ENCRYPTION_KEY is not set (see `deploy/propi.env.example`)");
  return createSecretCipher(key);
}
