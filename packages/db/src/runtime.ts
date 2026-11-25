// Production Clock and Ids ports (G10: ids are UUIDv7). Adapters may use I/O and randomness; core may not.
import { randomBytes } from "node:crypto";
import type { Clock, Ids, Instant } from "@propi/core";

/** RFC 9562 UUIDv7: 48-bit unix ms timestamp, version 7, variant 10, random rest. */
export function uuidv7(nowMs: number = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(nowMs, 0, 6);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const systemClock: Clock = { now: () => Date.now() as Instant };

export const uuidv7Ids: Ids = { next: () => uuidv7() };
