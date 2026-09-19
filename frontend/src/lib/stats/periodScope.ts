import { classifyPlace, visitCountsForYear } from "../../shared/placeCounting";
import type { Cruise } from "../../types/cruise";
import type { Place } from "../../types/place";

/**
 * The rows a statistics tab counts for one calendar year, where the tab counts
 * them in the browser rather than asking the server.
 *
 * The rule is the one the server applies to `/stats/cruise?year=` and
 * `/stats/lodging?year=` (`backend/src/utils/stats/domainYear.ts`) and the
 * overview applies to every domain: an event belongs to the UTC year it BEGAN
 * in. Stated a third time here only because these rows never reach that
 * endpoint; a tab that bucketed by local time would move a New Year's Eve
 * departure into the other year than the overview beside it.
 */

function utcYear(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.getUTCFullYear();
}

/**
 * Cruises that started in `year`. A cruise with no start date cannot be placed
 * in any year, so a year drops it — the lifetime view still counts it.
 */
export function cruisesStartedIn(cruises: readonly Cruise[], year: number): Cruise[] {
  return cruises.filter((c) => utcYear(c.startDate) === year);
}

/**
 * The places visited in `year`, each carrying only that year's visits.
 *
 * A place counts for a year when a visit that HAPPENED is dated in it. Three
 * things therefore stay out, each on purpose:
 *
 * - A wishlist entry. It has no date, only a state — the same reason a
 *   bookmarked house belongs to no year on the lodging tab.
 * - A place marked visited with no dated visit. It happened, but nobody can
 *   say when; the lifetime view counts it and no year may claim it.
 * - A visit dated later this year. `classifyVisit` calls it planned, exactly
 *   as the lifetime figures do, so the year cannot run ahead of them.
 */
export function placesVisitedIn(
  places: readonly Place[],
  year: number,
  now: Date = new Date()
): Place[] {
  return places
    .filter((place) => classifyPlace(place) === "visited")
    .map((place) => ({
      ...place,
      // The rule itself lives in `shared/placeCounting.ts`, which the backend
      // mirrors — the evidence panel cuts the same rows to the same year, and
      // a second copy of a year window is how a panel comes to name a visit
      // this tab never counted.
      visits: place.visits.filter((visit) => visitCountsForYear(visit, year, now)),
    }))
    .filter((place) => place.visits.length > 0);
}
