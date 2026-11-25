// Lock keys and their global order (architecture G4, §1.6).

export type LockKey =
  | `gift:${string}`
  | `redemption:${string}`
  | `collab:${string}`
  | `quest:${string}`
  | `budget:${string}`
  | `prepaid:${string}`
  | `member:${string}`;

const RANK: Readonly<Record<string, number>> = {
  gift: 0,
  redemption: 0,
  collab: 0,
  quest: 0,
  budget: 1,
  prepaid: 1,
  member: 2,
};

const rank = (k: LockKey): number => RANK[k.slice(0, k.indexOf(":"))] ?? 3;

/** Aggregate keys first, then budget/prepaid, then members ascending. Deduplicated. */
export function orderLocks(keys: Iterable<LockKey>): LockKey[] {
  return [...new Set(keys)].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}
