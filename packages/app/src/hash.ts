// Request hash for G2: same key + different payload -> idempotency_key_reused.
// Pure (no node:crypto) so the app stays runtime-agnostic: stable JSON + FNV-1a 64-bit.

function stable(value: unknown): unknown {
  if (value instanceof Map) return { $map: [...value.entries()].map(([k, v]) => [stable(k), stable(v)]) };
  if (value instanceof Set) return { $set: [...value].map(stable) };
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = stable((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stable(value)) ?? "undefined";
}

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

export function fnv1a64(text: string): string {
  let h = OFFSET;
  // UTF-16 code units: deterministic, and no TextEncoder (not in the ES lib).
  for (let i = 0; i < text.length; i++) h = ((h ^ BigInt(text.charCodeAt(i))) * PRIME) & MASK;
  return h.toString(16).padStart(16, "0");
}

/** Hash of the command payload, excluding its key (the key is the identity, not the request). */
export function requestHash(command: { readonly key: unknown }): string {
  const { key: _key, ...payload } = command as Record<string, unknown>;
  return fnv1a64(stableStringify(payload));
}
