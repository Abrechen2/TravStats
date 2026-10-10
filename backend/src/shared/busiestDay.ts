/**
 * The busiest day: the calendar day with the most flights, and on a tie the
 * LATEST such day (forgejo#256). One rule for the fun statistics' "fastest
 * day" and the records' "busiest day", which answered the same question with
 * two tie rules — the first day in database order against the latest day — so
 * one account could see two different days named.
 *
 * The latest day wins because the records took that rule from the Companion
 * (`records-adapters.ts`), and a ranking that names the most recent of equal
 * achievements is the one a traveller recognises.
 *
 * MIRRORED at `frontend/src/shared/busiestDay.ts`; change both together. Each
 * side has its own test of the same truth table.
 */
export function busiestDayOf(
  counts: Iterable<readonly [day: string, flights: number]>
): { day: string; flights: number } | null {
  let best: { day: string; flights: number } | null = null;
  for (const [day, flights] of counts) {
    if (best === null || flights > best.flights || (flights === best.flights && day > best.day)) {
      best = { day, flights };
    }
  }
  return best;
}
