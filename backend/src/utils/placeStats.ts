import { classifyPlace, classifyVisit } from '../shared/placeCounting';
import { getContinent } from './continents';

/**
 * POI measures for the achievement engine.
 *
 * Every count goes through `shared/placeCounting.ts` instead of re-deriving the
 * rule. That matters more here than anywhere else in the domain, because the
 * rule is counter-intuitive twice over: an UNDATED visit counts, and a
 * FUTURE-dated one does not. A badge that disagreed with the number on the
 * stats page would be the exact failure the shared module exists to prevent.
 *
 * WHERE AN UNDATED VISIT LANDS, since half the measures below turn on it: it
 * counts towards anything that asks HOW MANY, and towards nothing that asks
 * WHEN. It is a visit with no day, so it cannot be in a streak, in a busiest
 * day, or in a calendar year — and quietly placing it in one would hand out a
 * badge for a day that never happened.
 */

export interface PlaceStatsInput {
  visited: boolean;
  category: string;
  isoCountryCode: string | null;
  city: string | null;
  lat: number;
  lon: number;
  /** `"<listKey>:<slug>"` when this place was materialised from a checklist. */
  curatedItemId: string | null;
  visits: readonly { visitedAt: Date | null; rating?: number | null; tripId?: string | null }[];
}

export interface PlaceStats {
  /** Places that count — `visited`, wishlist entries excluded. */
  placesCount: number;
  /** Visits that happened; three trips to one McDonald's are three. */
  placeVisitsCount: number;
  /** Distinct ISO country codes among counting places. */
  placeCountries: Set<string>;
  /** Biggest single category — "25 of one kind", whichever kind that is. */
  placesInCategoryMax: number;
  /**
   * Ticked targets per checklist key. A checklist achievement asks about ONE
   * list, so a single maximum would make every wonders badge show the same
   * number; the map keeps them apart.
   */
  curatedTickedByList: Map<string, number>;

  /** Distinct cities. A place with no city is in none rather than in a blank one. */
  placeCities: Set<string>;
  /** Distinct continents, resolved from the coordinates like everywhere else. */
  placeContinents: Set<string>;
  /** How many of the category catalogue have been used at least once. */
  placeCategoriesUnique: number;
  /** Most visits to a SINGLE place — the regular haunt. */
  placeSameRepeatMax: number;
  /** Most distinct places visited on one calendar day. */
  placesInOneDayMax: number;
  /** Longest run of consecutive days carrying at least one visit. */
  placeVisitStreakMax: number;
  /** Most visits inside one calendar year. */
  placeVisitsInYearMax: number;
  /** Most distinct countries reached inside one calendar year. */
  placeCountriesInYearMax: number;
  /** Visits carrying a rating — an unrated visit is not a nought. */
  placeRatedVisits: number;
  /** Visits attached to a trip. */
  placeTripVisits: number;
  /** Northernmost and southernmost latitude reached, or null for none. */
  placeNorthernLat: number | null;
  placeSouthernLat: number | null;
}

export function emptyPlaceStats(): PlaceStats {
  return {
    placesCount: 0,
    placeVisitsCount: 0,
    placeCountries: new Set<string>(),
    placesInCategoryMax: 0,
    curatedTickedByList: new Map<string, number>(),

    placeCities: new Set<string>(),
    placeContinents: new Set<string>(),
    placeCategoriesUnique: 0,
    placeSameRepeatMax: 0,
    placesInOneDayMax: 0,
    placeVisitStreakMax: 0,
    placeVisitsInYearMax: 0,
    placeCountriesInYearMax: 0,
    placeRatedVisits: 0,
    placeTripVisits: 0,
    placeNorthernLat: null,
    placeSouthernLat: null,
  };
}

const DAY_MS = 86_400_000;

/** Longest run of consecutive calendar days in a set of `YYYY-MM-DD` strings. */
export function longestDayStreak(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = Date.parse(`${sorted[i - 1]}T00:00:00Z`);
    const current = Date.parse(`${sorted[i]}T00:00:00Z`);
    // Compared as calendar days, not by elapsed time: an hour of daylight
    // saving must not break a run that a calendar plainly shows as unbroken.
    run = current - previous === DAY_MS ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

export function calculatePlaceStats(
  places: readonly PlaceStatsInput[],
  now: Date = new Date(),
): PlaceStats {
  const stats = emptyPlaceStats();
  const byCategory = new Map<string, number>();

  const placesPerDay = new Map<string, Set<number>>();
  const visitsPerYear = new Map<number, number>();
  const countriesPerYear = new Map<number, Set<string>>();

  places.forEach((place, index) => {
    // A wishlist entry — and an unticked checklist target, which is the same
    // thing wearing a different hat — contributes to nothing at all.
    if (classifyPlace(place) !== 'visited') return;

    stats.placesCount += 1;

    const country = place.isoCountryCode ? place.isoCountryCode.toUpperCase() : null;
    if (country) stats.placeCountries.add(country);
    if (place.city) stats.placeCities.add(place.city);

    const continent = getContinent(place.lat, place.lon, country);
    if (continent) stats.placeContinents.add(continent);

    if (stats.placeNorthernLat === null || place.lat > stats.placeNorthernLat) {
      stats.placeNorthernLat = place.lat;
    }
    if (stats.placeSouthernLat === null || place.lat < stats.placeSouthernLat) {
      stats.placeSouthernLat = place.lat;
    }

    byCategory.set(place.category, (byCategory.get(place.category) ?? 0) + 1);

    let visitsHere = 0;
    for (const visit of place.visits) {
      if (classifyVisit(visit, now) !== 'visited') continue;
      stats.placeVisitsCount += 1;
      visitsHere += 1;
      if (typeof visit.rating === 'number') stats.placeRatedVisits += 1;
      if (visit.tripId) stats.placeTripVisits += 1;

      // From here on the measure asks WHEN, and an undated visit has no answer.
      if (!visit.visitedAt) continue;
      const at = visit.visitedAt;
      if (Number.isNaN(at.getTime())) continue;

      const year = at.getUTCFullYear();
      visitsPerYear.set(year, (visitsPerYear.get(year) ?? 0) + 1);
      if (country) {
        const seen = countriesPerYear.get(year) ?? new Set<string>();
        seen.add(country);
        countriesPerYear.set(year, seen);
      }

      const day = at.toISOString().slice(0, 10);
      const onThatDay = placesPerDay.get(day) ?? new Set<number>();
      // Keyed on the place, not on the visit: three coffees at one café is one
      // place that day, or "most places in a day" rewards sitting still.
      onThatDay.add(index);
      placesPerDay.set(day, onThatDay);
    }

    if (visitsHere > stats.placeSameRepeatMax) stats.placeSameRepeatMax = visitsHere;

    if (place.curatedItemId) {
      // Ids are namespaced `listKey:slug`, so the prefix IS the list. Same
      // split the curated routes do — no extra join to learn which checklist
      // a ticked place belongs to.
      const listKey = place.curatedItemId.split(':')[0];
      if (listKey) {
        stats.curatedTickedByList.set(listKey, (stats.curatedTickedByList.get(listKey) ?? 0) + 1);
      }
    }
  });

  stats.placesInCategoryMax = Math.max(0, ...Array.from(byCategory.values()));
  stats.placeCategoriesUnique = byCategory.size;
  stats.placesInOneDayMax = Math.max(
    0,
    ...Array.from(placesPerDay.values(), (set) => set.size),
  );
  stats.placeVisitStreakMax = longestDayStreak(placesPerDay.keys());
  stats.placeVisitsInYearMax = Math.max(0, ...Array.from(visitsPerYear.values()));
  stats.placeCountriesInYearMax = Math.max(
    0,
    ...Array.from(countriesPerYear.values(), (set) => set.size),
  );

  return stats;
}
