import { classifyPlace, classifyVisit } from '../shared/placeCounting';

/**
 * POI measures for the achievement engine.
 *
 * Single file rather than a folder like `lodgingStats/`: there are four
 * measures here, not forty, and splitting four counters across six modules
 * would be ceremony. It gets a folder the day it earns one.
 *
 * Every count goes through `shared/placeCounting.ts` instead of re-deriving
 * the rule. That matters more here than anywhere else in the domain, because
 * the rule is counter-intuitive twice over: an UNDATED visit counts, and a
 * FUTURE-dated one does not. A badge that disagreed with the number on the
 * stats page would be the exact failure the shared module exists to prevent.
 */

export interface PlaceStatsInput {
  visited: boolean;
  category: string;
  isoCountryCode: string | null;
  /** `"<listKey>:<slug>"` when this place was materialised from a checklist. */
  curatedItemId: string | null;
  visits: readonly { visitedAt: Date | null }[];
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
}

export function emptyPlaceStats(): PlaceStats {
  return {
    placesCount: 0,
    placeVisitsCount: 0,
    placeCountries: new Set<string>(),
    placesInCategoryMax: 0,
    curatedTickedByList: new Map<string, number>(),
  };
}

export function calculatePlaceStats(
  places: readonly PlaceStatsInput[],
  now: Date = new Date(),
): PlaceStats {
  const stats = emptyPlaceStats();
  const byCategory = new Map<string, number>();

  for (const place of places) {
    // A wishlist entry — and an unticked checklist target, which is the same
    // thing wearing a different hat — contributes to nothing at all.
    if (classifyPlace(place) !== 'visited') continue;

    stats.placesCount += 1;

    for (const visit of place.visits) {
      if (classifyVisit(visit, now) === 'visited') stats.placeVisitsCount += 1;
    }

    if (place.isoCountryCode) {
      stats.placeCountries.add(place.isoCountryCode.toUpperCase());
    }

    byCategory.set(place.category, (byCategory.get(place.category) ?? 0) + 1);

    if (place.curatedItemId) {
      // Ids are namespaced `listKey:slug`, so the prefix IS the list. Same
      // split the curated routes do — no extra join to learn which checklist
      // a ticked place belongs to.
      const listKey = place.curatedItemId.split(':')[0];
      if (listKey) {
        stats.curatedTickedByList.set(listKey, (stats.curatedTickedByList.get(listKey) ?? 0) + 1);
      }
    }
  }

  stats.placesInCategoryMax = Math.max(0, ...Array.from(byCategory.values()));
  return stats;
}
