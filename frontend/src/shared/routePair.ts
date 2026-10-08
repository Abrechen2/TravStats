/**
 * Frontend MIRROR of `backend/src/shared/routePair.ts` (Forgejo #254).
 *
 * A CONNECTION is the UNORDERED pair of airports: HNL-OGG and OGG-HNL are one
 * connection. The server already groups `/stats/routes`, the Route Master fun
 * fact, the Wrapped top route and the route badges that way; the Globe groups its
 * arcs that way here. The rules MUST stay identical — both sides are covered by
 * tests asserting the same truth table.
 *
 * A flight with an unknown end is on no connection (null), never on an airport
 * called "null".
 */

/** The two codes in canonical (code-unit sorted) order — the one place a pair is ordered. */
export function canonicalRoutePair(a: string, b: string): readonly [string, string] {
  return a <= b ? [a, b] : [b, a];
}

const normaliseCode = (code: string | null | undefined): string | null => {
  const trimmed = code?.trim().toUpperCase();
  return trimmed ? trimmed : null;
};

/**
 * The key of the connection a flight is on — `"HNL-OGG"` for either direction —
 * or null when either end is unknown.
 */
export function routePairKey(
  dep: string | null | undefined,
  arr: string | null | undefined
): string | null {
  const from = normaliseCode(dep);
  const to = normaliseCode(arr);
  if (from === null || to === null) return null;
  const [lo, hi] = canonicalRoutePair(from, to);
  return `${lo}-${hi}`;
}
