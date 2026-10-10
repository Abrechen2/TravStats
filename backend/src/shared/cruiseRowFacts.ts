/**
 * What ONE cruise row says about itself, for the cruise tab's row-level
 * blocks (rhythm and fun, forgejo#257) and for the evidence panel behind
 * them. The tab folds these over the cruise list
 * (`lib/stats/cruiseStatsDetail.ts`); the panel lists the same cruises with
 * the same numbers (`services/evidence/metricEvidenceCruiseDetail.ts`). One
 * rule, two readers — a second spelling in the resolver would let the panel
 * name a cruise the tile never counted.
 *
 * MIRRORED at `frontend/src/shared/cruiseRowFacts.ts`; change both together.
 */

const DAY_MS = 86_400_000;

/** A cruise date as the list sends it (an ISO string) or the database holds it. */
export type CruiseDateLike = string | Date | null | undefined;

function msOf(value: CruiseDateLike): number {
  if (value === null || value === undefined) return Number.NaN;
  return typeof value === "string" ? Date.parse(value) : value.getTime();
}

/**
 * Nights between start and end, or null when either is missing, unreadable,
 * or the end lies before the start. A cruise's dates are calendar days pinned
 * to UTC midnight, so the difference is whole days; rounding absorbs a stray
 * time of day rather than dropping a night.
 */
export function cruiseNights(start: CruiseDateLike, end: CruiseDateLike): number | null {
  const from = msOf(start);
  const to = msOf(end);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.round((to - from) / DAY_MS);
}

/** The month (0–11) a cruise started in, read in UTC; null without a start date. */
export function cruiseStartMonth(start: CruiseDateLike): number | null {
  const at = msOf(start);
  return Number.isNaN(at) ? null : new Date(at).getUTCMonth();
}

/**
 * The port calls the itinerary LISTS: every stop that is not a sea day,
 * matched to the catalogue or not. Sea days are not port calls — counting
 * them made a transatlantic crossing the most-visited itinerary — and the
 * embarkation and disembarkation ports count only where they are listed as a
 * stop, unlike the rollup's effective sequence (`utils/cruiseStats.ts`).
 */
export function listedPortCalls(stops: readonly { isAtSea: boolean }[] | null | undefined): number {
  return (stops ?? []).filter((stop) => !stop.isAtSea).length;
}
