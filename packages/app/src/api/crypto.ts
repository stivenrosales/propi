/// <reference types="node" />
// The node:crypto implementation of core's Crypto port (S98 token hashes, S99 webhook signatures).
// The only file in packages/app that touches a runtime crypto API.
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Crypto } from "@propi/core";

export const nodeCrypto: Crypto = {
  hmacSha256Hex: (secret, message) => createHmac("sha256", secret).update(message, "utf8").digest("hex"),
  sha256Hex: (text) => createHash("sha256").update(text, "utf8").digest("hex"),
  randomToken: (bytes) => randomBytes(bytes).toString("base64url"),
};
