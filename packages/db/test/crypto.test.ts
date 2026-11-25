// AES-256-GCM secrets at rest (architecture §8: ENCRYPTION_KEY encrypts webhook secrets and Slack tokens).
import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createSecretCipher, parseEncryptionKey, secretCipherFromEnv } from "../src/index.ts";

const HEX_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("secret cipher", () => {
  test("round-trips, with a fresh IV per value and no plaintext in the stored form", () => {
    const c = createSecretCipher(HEX_KEY);
    const a = c.encrypt("whsec_plain", "webhook:ws:ep");
    const b = c.encrypt("whsec_plain", "webhook:ws:ep");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(a).not.toContain("whsec_plain");
    expect(c.decrypt(a, "webhook:ws:ep")).toBe("whsec_plain");
    expect(c.decrypt(c.encrypt("", "ctx"), "ctx")).toBe("");
    expect(c.decrypt(c.encrypt("ñandú 🌮", "ctx"), "ctx")).toBe("ñandú 🌮");
  });

  test("refuses another row's context, another key, or a tampered value", () => {
    const c = createSecretCipher(HEX_KEY);
    const stored = c.encrypt("token", "install:slack:T1");
    expect(() => c.decrypt(stored, "install:slack:T2")).toThrow();
    expect(() => createSecretCipher(randomBytes(32).toString("base64")).decrypt(stored, "install:slack:T1")).toThrow();
    const [v, iv, tag, ct] = stored.split(".") as [string, string, string, string];
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => c.decrypt([v, iv, tag, flipped.toString("base64url")].join("."), "install:slack:T1")).toThrow();
    expect(() => c.decrypt("plaintext", "install:slack:T1")).toThrow(/unrecognized/);
  });

  test("ENCRYPTION_KEY is 32 bytes as hex or base64; missing or short keys fail", () => {
    const b64 = Buffer.from(HEX_KEY, "hex").toString("base64");
    expect(parseEncryptionKey(HEX_KEY)).toEqual(parseEncryptionKey(b64));
    expect(() => parseEncryptionKey("too-short")).toThrow(/32 bytes/);
    expect(() => secretCipherFromEnv({})).toThrow(/ENCRYPTION_KEY is not set/);
    const c = secretCipherFromEnv({ ENCRYPTION_KEY: b64 });
    expect(createSecretCipher(HEX_KEY).decrypt(c.encrypt("x", "k"), "k")).toBe("x");
  });
});
