import type { Flight } from "../types";

/**
 * Order flights for trip-leg display: stable timestamp sort first, then a
 * topological repair pass for same-day groups whose timestamp order does
 * not reflect the IATA chain.
 *
 * Why this is needed: DATE_ONLY rows store a 12:00 UTC placeholder. A
 * timed flight on the same day at 20:58 UTC sorts after the placeholder
 * even when chronologically it must come first (e.g. OGG→HNL precedes
 * HNL→SFO in a Hawaii return leg). Pure timestamp sort gets it wrong.
 *
 * The repair walks each contiguous same-day window and reorders it as a
 * chain: pick the head whose `depIata` is not used as any other flight's
 * `arrIata` within the window, then extend by `prev.arrIata === next.depIata`.
 * Falls back to the original timestamp order if the window cannot be
 * resolved into a single chain (e.g. two disjoint trips on the same day,
 * or ambiguous data) — better stable than re-shuffled.
 */
export function sortFlightsByLegOrder(flights: Flight[]): Flight[] {
  const sorted = [...flights].sort((a, b) => {
    const ta = a.departureTime ? new Date(a.departureTime).getTime() : 0;
    const tb = b.departureTime ? new Date(b.departureTime).getTime() : 0;
    return ta - tb;
  });

  // Walk same-day windows and try to chain-repair each.
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sameYmd(sorted[i].departureTime, sorted[j].departureTime)) {
      j++;
    }
    if (j - i >= 2) {
      const repaired = repairSameDayChain(sorted.slice(i, j));
      if (repaired) {
        for (let k = 0; k < repaired.length; k++) sorted[i + k] = repaired[k];
      }
    }
    i = j;
  }

  return sorted;
}

/**
 * Try to reorder a same-day window into a single connected IATA chain.
 * Returns null when no unique head exists (= can't pick a deterministic
 * starting flight) so the caller keeps the timestamp order.
 */
function repairSameDayChain(window: Flight[]): Flight[] | null {
  if (window.length < 2) return null;
  const arrIatas = new Set(
    window.map((f) => f.arrIata).filter((x): x is string => typeof x === "string"),
  );
  const heads = window.filter((f) => f.depIata && !arrIatas.has(f.depIata));
  if (heads.length !== 1) return null;

  const remaining = new Set(window);
  const out: Flight[] = [];
  let current: Flight | undefined = heads[0];
  while (current) {
    out.push(current);
    remaining.delete(current);
    const next: Flight | undefined = [...remaining].find(
      (f) => f.depIata && current!.arrIata && f.depIata === current!.arrIata,
    );
    current = next;
  }
  // Disconnected segment (some flights left unchained) → keep original.
  if (remaining.size > 0) return null;
  return out;
}

function sameYmd(a: string | Date | null | undefined, b: string | Date | null | undefined): boolean {
  if (!a || !b) return false;
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10);
}
