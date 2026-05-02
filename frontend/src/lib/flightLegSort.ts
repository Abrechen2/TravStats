import type { Flight } from "../types";

/**
 * Order flights for trip-leg display: stable timestamp sort first, then a
 * topological pass that fixes adjacent same-date pairs whose chain is
 * reversed. The chain check is `prev.arrIata === next.depIata`; we only
 * swap when (a) both flights are on the same calendar day, (b) the
 * current order is *not* a chain, and (c) the swapped order *is* a chain.
 *
 * Why this is needed: DATE_ONLY rows store a 12:00 UTC placeholder. A
 * timed flight on the same day at 20:58 UTC sorts after the placeholder
 * even when chronologically it must come first (e.g. OGG→HNL precedes
 * HNL→SFO in a Hawaii return leg). Pure timestamp sort gets it wrong;
 * topological repair gets it right without inventing synthetic times.
 */
export function sortFlightsByLegOrder(flights: Flight[]): Flight[] {
  const sorted = [...flights].sort((a, b) => {
    const ta = a.departureTime ? new Date(a.departureTime).getTime() : 0;
    const tb = b.departureTime ? new Date(b.departureTime).getTime() : 0;
    return ta - tb;
  });

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!sameYmd(a.departureTime, b.departureTime)) continue;
    const chainAB = a.arrIata && b.depIata && a.arrIata === b.depIata;
    const chainBA = b.arrIata && a.depIata && b.arrIata === a.depIata;
    if (!chainAB && chainBA) {
      sorted[i] = b;
      sorted[i + 1] = a;
    }
  }

  return sorted;
}

function sameYmd(a: string | Date | null | undefined, b: string | Date | null | undefined): boolean {
  if (!a || !b) return false;
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10);
}
