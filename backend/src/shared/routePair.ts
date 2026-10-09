/**
 * Single source of truth for "which connection is this flight on?" — Forgejo
 * #254, building on the owner's decision of 2026-08-31 (Forgejo #42).
 *
 * A CONNECTION is the UNORDERED pair of airports. HNL-OGG and OGG-HNL are one
 * connection, because a person who says "I have flown Honolulu-Maui nine times"
 * means both directions. `/stats/routes`, the Route Master fun fact, the Wrapped
 * top route, the Globe's arcs and the "Fly the same route N times" badges all
 * read this rule; before #254 the fun fact and the badge keyed on the DIRECTED
 * pair, so one account showed Route Master "HNL-OGG ×4" next to a top-routes
 * list whose first entry was the same connection flown eight times.
 *
 * ## What is deliberately directed
 *
 * Two views stay directed, and say so in their copy: "Groundhog Day" (the same
 * leg, the same way, on three consecutive days) and "There and Back Again" (a
 * route AND its exact reverse on one day). Anything new that wants the direction
 * must label itself as directed rather than quietly keying on `${dep}-${arr}`.
 *
 * ## Abstention
 *
 * A flight with an unknown end is on NO connection. The old keys turned the gap
 * into the string "null" or "?" and then ranked it like an airport.
 *
 * MIRRORED in `frontend/src/shared/routePair.ts`. Change both together.
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
