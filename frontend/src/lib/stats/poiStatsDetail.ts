/**
 * The places figures the statistics page draws, derived once.
 *
 * A pure function over the rows, so every number on that page can be tested
 * without a browser and none of them are counted inline in a component. The
 * counting RULES are not re-decided here: what counts as visited, and whether a
 * future-dated visit has happened yet, come from `shared/placeCounting` — the
 * same module the server's achievement engine uses. That is what keeps this
 * page from disagreeing with the places list and with the badges.
 *
 * WHAT AN UNDATED VISIT DOES AND DOES NOT DO, because it decides half the
 * figures below: it counts towards totals — it happened, the user just cannot
 * say when — and it marks no day, month, year or weekday. So a rhythm chart is
 * built from dated visits only, while "how many visits" counts both. Silently
 * dropping the undated ones would make the totals disagree with the list;
 * silently placing them on a day would invent a fact.
 */

import { classifyPlace, classifyVisit } from "../../shared/placeCounting";
import type { Place, PlaceVisit } from "../../types/place";

export interface RatedPlace {
  placeId: string;
  name: string;
  rating: number;
}

export interface DatedVisit {
  placeId: string;
  name: string;
  at: Date;
}

export interface PoiStatsDetail {
  /** Places that count as visited, per the shared rule. */
  visitedPlaces: Place[];
  /** Rows the user means to go to, not ones they have been to. */
  wishlistCount: number;

  visitsTotal: number;
  visitsDated: number;
  visitsUndated: number;

  /** Dated visits per calendar year, ascending. */
  byYear: Array<{ year: number; visits: number }>;
  /** Dated visits per month of the year (1–12), always all twelve. */
  byMonth: number[];
  /**
   * Dated visits per weekday, SUNDAY first.
   *
   * Sunday-first because the flight statistics already are — they index
   * `getDay()` straight into `stats:weekdays.*`, which starts at sunday. A
   * German week starts on Monday and arguably both pages should, but two pages
   * in one product disagreeing about the order is the worse of the two
   * problems. If it changes, it changes in both places at once.
   */
  byWeekday: number[];

  countries: Map<string, number>;
  cities: Map<string, number>;
  categories: Map<string, number>;

  /** Every category the catalogue offers, and whether it has been used. */
  categoryCoverage: { used: number; total: number };

  northernmost: Place | null;
  southernmost: Place | null;

  /** Places by how often they have been visited, most first. */
  mostVisited: Array<{ place: Place; visits: number }>;

  firstVisit: DatedVisit | null;
  latestVisit: DatedVisit | null;

  /** The day with the most places visited, and how many. */
  busiestDay: { date: string; places: number } | null;

  /**
   * The longest run of consecutive calendar days with at least one visit.
   * A single visit is a streak of one; nothing dated is null.
   */
  longestStreakDays: number | null;

  /** Rated visits only — an unrated visit is not a zero. */
  averageRating: number | null;
  ratedVisits: number;
  bestRated: RatedPlace[];

  /** Visits attached to a trip, out of all visits. */
  visitsOnTrips: number;
}

const MONTHS = 12;
const WEEKDAYS = 7;

/** Sunday-first, matching the flight statistics — see `byWeekday`. */
const weekdayIndex = (d: Date): number => d.getUTCDay();

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function derivePoiStats(
  places: readonly Place[],
  categoryCount: number,
  now: Date = new Date()
): PoiStatsDetail {
  const visitedPlaces = places.filter((p) => classifyPlace(p) === "visited");

  const countries = new Map<string, number>();
  const cities = new Map<string, number>();
  const categories = new Map<string, number>();

  const yearCounts = new Map<number, number>();
  const byMonth = new Array<number>(MONTHS).fill(0);
  const byWeekday = new Array<number>(WEEKDAYS).fill(0);

  const placesPerDay = new Map<string, Set<string>>();
  const datedVisits: DatedVisit[] = [];
  const ratings: RatedPlace[] = [];
  const mostVisited: Array<{ place: Place; visits: number }> = [];

  let visitsTotal = 0;
  let visitsUndated = 0;
  let visitsOnTrips = 0;

  let northernmost: Place | null = null;
  let southernmost: Place | null = null;

  for (const place of visitedPlaces) {
    const country = place.isoCountryCode?.toUpperCase();
    if (country) bump(countries, country);
    if (place.city) bump(cities, place.city);
    bump(categories, place.category);

    if (northernmost === null || place.lat > northernmost.lat) northernmost = place;
    if (southernmost === null || place.lat < southernmost.lat) southernmost = place;

    let visitsHere = 0;
    for (const visit of place.visits as PlaceVisit[]) {
      if (classifyVisit(visit, now) !== "visited") continue;
      visitsHere += 1;
      visitsTotal += 1;
      if (visit.tripId) visitsOnTrips += 1;
      if (typeof visit.rating === "number") {
        ratings.push({ placeId: place.id, name: place.name, rating: visit.rating });
      }

      if (!visit.visitedAt) {
        visitsUndated += 1;
        continue;
      }
      const at = new Date(visit.visitedAt);
      if (Number.isNaN(at.getTime())) {
        // A date the browser cannot read is not a date. Counted in the total —
        // the visit happened — but it marks no day.
        visitsUndated += 1;
        continue;
      }

      datedVisits.push({ placeId: place.id, name: place.name, at });
      yearCounts.set(at.getUTCFullYear(), (yearCounts.get(at.getUTCFullYear()) ?? 0) + 1);
      byMonth[at.getUTCMonth()] += 1;
      byWeekday[weekdayIndex(at)] += 1;

      const day = ymd(at);
      const seen = placesPerDay.get(day) ?? new Set<string>();
      seen.add(place.id);
      placesPerDay.set(day, seen);
    }

    if (visitsHere > 0) mostVisited.push({ place, visits: visitsHere });
  }

  datedVisits.sort((a, b) => a.at.getTime() - b.at.getTime());
  mostVisited.sort((a, b) => b.visits - a.visits || a.place.name.localeCompare(b.place.name));

  let busiestDay: PoiStatsDetail["busiestDay"] = null;
  for (const [date, ids] of placesPerDay) {
    if (busiestDay === null || ids.size > busiestDay.places) {
      busiestDay = { date, places: ids.size };
    }
  }

  return {
    visitedPlaces,
    wishlistCount: places.length - visitedPlaces.length,

    visitsTotal,
    visitsDated: datedVisits.length,
    visitsUndated,

    byYear: [...yearCounts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, visits]) => ({ year, visits })),
    byMonth,
    byWeekday,

    countries,
    cities,
    categories,
    categoryCoverage: { used: categories.size, total: categoryCount },

    northernmost,
    southernmost,

    mostVisited,

    firstVisit: datedVisits[0] ?? null,
    latestVisit: datedVisits[datedVisits.length - 1] ?? null,

    busiestDay,
    longestStreakDays: longestRunOfDays([...placesPerDay.keys()]),

    averageRating:
      ratings.length > 0 ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length : null,
    ratedVisits: ratings.length,
    bestRated: [...ratings]
      .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))
      .slice(0, 5),

    visitsOnTrips,
  };
}

/**
 * The longest run of consecutive calendar days present in the set.
 *
 * Days are compared as UTC dates rather than by subtracting timestamps: an
 * hour of daylight saving would otherwise break a run, and the run is about
 * days on a calendar, not about elapsed time.
 */
export function longestRunOfDays(days: readonly string[]): number | null {
  if (days.length === 0) return null;
  const sorted = [...new Set(days)].sort();
  let best = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = Date.parse(`${sorted[i - 1]}T00:00:00Z`);
    const day = Date.parse(`${sorted[i]}T00:00:00Z`);
    current = day - previous === 86_400_000 ? current + 1 : 1;
    if (current > best) best = current;
  }
  return best;
}
