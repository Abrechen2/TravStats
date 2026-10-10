/**
 * Which month, weekday, day and run of days the places "rhythm" names
 * (forgejo#259) — the tie rules, in one place.
 *
 * The statistics tab folds the figures in the browser
 * (`lib/stats/poiStatsDetail.ts`) and the evidence panel lists the visits
 * behind them on the server (`services/evidence/metricEvidencePlaceDetail.ts`).
 * Two sides picking "the busiest day" each by their own iteration order is how
 * a panel comes to list a different day than the tile names, so both ask
 * these functions, and every tie is broken by the calendar, never by the order
 * rows happened to arrive in.
 *
 * MIRRORED at `backend/src/shared/placeRhythm.ts`; change both together.
 */

/** The first index holding the largest count; null when nothing was counted. */
export function busiestIndex(counts: readonly number[]): number | null {
  let best: number | null = null;
  counts.forEach((count, index) => {
    if (count > 0 && (best === null || count > counts[best])) best = index;
  });
  return best;
}

/**
 * The day with the most DISTINCT places; on a tie the earliest day. Keys are
 * `YYYY-MM-DD`, so a string comparison is a calendar comparison.
 */
export function busiestDay(
  placesPerDay: ReadonlyMap<string, ReadonlySet<string>>
): { date: string; places: number } | null {
  let best: { date: string; places: number } | null = null;
  for (const [date, ids] of placesPerDay) {
    if (best === null || ids.size > best.places || (ids.size === best.places && date < best.date)) {
      best = { date, places: ids.size };
    }
  }
  return best;
}

const DAY_MS = 86_400_000;

/**
 * The longest run of consecutive calendar days in the set; on a tie the
 * earliest run. Days are compared as calendar dates, never by subtracting
 * local timestamps — an hour of daylight saving would otherwise break a run.
 */
export function longestRun(
  days: readonly string[]
): { first: string; last: string; days: number } | null {
  if (days.length === 0) return null;
  const sorted = [...new Set(days)].sort();
  let best = { first: sorted[0], last: sorted[0], days: 1 };
  let start = sorted[0];
  let length = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = Date.parse(`${sorted[i]}T00:00:00Z`) - Date.parse(`${sorted[i - 1]}T00:00:00Z`);
    if (gap === DAY_MS) {
      length += 1;
    } else {
      start = sorted[i];
      length = 1;
    }
    if (length > best.days) best = { first: start, last: sorted[i], days: length };
  }
  return best;
}
