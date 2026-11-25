// Ledger sums are computed as bigint in SQL (SUM over INTEGER is BIGINT; a workspace's history may
// pass 2^31 units) and converted to JS numbers here, failing loudly instead of losing precision.
export function safeNumber(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "bigint" ? Number(v) : v;
  if (!Number.isSafeInteger(n)) throw new Error(`ledger sum ${String(v)} exceeds the safe integer range`);
  return n;
}
