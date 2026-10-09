import { canonicalRoutePair, routePairKey } from "../../shared/routePair";

interface ConnectionEnds {
  depIata?: string | null;
  depIcao?: string | null;
  arrIata?: string | null;
  arrIcao?: string | null;
}

/**
 * The most flown CONNECTION, as "HNL \u2194 OGG" - or null when no flight names
 * both of its airports.
 *
 * A connection is the unordered airport pair (`shared/routePair`, forgejo#254),
 * the same rule the server's top routes, Route Master and Wrapped follow. The
 * certificate and the year-report PDF used to key the DIRECTED "DEP \u2192 ARR",
 * so an out-and-back traveller's favourite route was whichever way they happened
 * to leave more often. A flight with an unknown end is on no connection. A tie
 * goes to the pair seen first. `separator` is for surfaces whose font has no
 * arrow (the PDF).
 */
export function favoriteConnection(
  flights: readonly ConnectionEnds[],
  separator = " \u2194 "
): string | null {
  const counts = new Map<string, number>();
  for (const f of flights) {
    const key = routePairKey(f.depIata || f.depIcao, f.arrIata || f.arrIcao);
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  if (best === null) return null;
  const [from, to] = best.split("-");
  const [lo, hi] = canonicalRoutePair(from, to);
  return `${lo}${separator}${hi}`;
}
