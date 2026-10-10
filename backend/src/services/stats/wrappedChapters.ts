/**
 * The year in review beyond flights, cruises and rail (forgejo#265): one
 * chapter per further domain the user sees — stays, places, roadtrips, day
 * tours, rentals, bus rides. Each row arrives already COUNTED and FILED by its
 * domain's own rule (the loader, `wrappedDomains.ts`, asks `lodgingCounting`,
 * `placeCounting`, `rentalCounting`, `busCounting`, …); this module only folds
 * one year out of them and names the years that hold anything.
 *
 * Three rules from the rest of the story hold here too:
 *  - a hidden domain is `null` — no chapter, no year in the picker — never a
 *    chapter of zeros (`wrapped.ts` rule 3);
 *  - the domains are NOT added together. A rental's days are rental days, not
 *    travel days on top of the trip's; a stay's nights are not added to a
 *    roadtrip's; each chapter says its own figure;
 *  - a figure that cannot be known abstains: a stay with no night count adds
 *    nothing to `nights` and is counted in `nightsUnknown` instead.
 *
 * Pure — no I/O.
 */
import type { EntryRef } from "./insights/measureItems";

/**
 * Each row may carry the entry it stands for — what the chapter's evidence
 * panel lists (`services/evidence/metricEvidenceWrapped.ts`), so the panel
 * names exactly the rows the chapter counted. The fold here never reads it.
 */
interface WithEntry {
  entry?: EntryRef;
}

export interface WrappedStayRow extends WithEntry {
  year: number;
  /** Null when the record does not say how many nights. */
  nights: number | null;
}
export interface WrappedVisitRow extends WithEntry {
  year: number;
  placeId: string;
}
export interface WrappedYearRow extends WithEntry {
  year: number;
}
export interface WrappedRentalRow extends WithEntry {
  year: number;
  days: number;
}
export interface WrappedBusRow extends WithEntry {
  year: number;
  distanceKm: number | null;
  nights: number;
}

/** `null` = the domain is hidden for this user (switched off, or behind the beta switch). */
export interface WrappedChapterRows {
  /**
   * Whether the user sees flights. Off, the flights neither tell the story nor
   * put a year in the picker — the rule every other domain follows (forgejo#265).
   * Optional: a caller that predates it keeps flights, as before.
   */
  flightsVisible?: boolean;
  lodging: WrappedStayRow[] | null;
  places: WrappedVisitRow[] | null;
  roadtrips: WrappedYearRow[] | null;
  tours: WrappedYearRow[] | null;
  rentals: WrappedRentalRow[] | null;
  bus: WrappedBusRow[] | null;
}

export const NO_CHAPTERS: WrappedChapterRows = {
  lodging: null,
  places: null,
  roadtrips: null,
  tours: null,
  rentals: null,
  bus: null,
};

export interface WrappedChapters {
  lodging: { stays: number; nights: number; nightsUnknown: number } | null;
  places: { visits: number; places: number } | null;
  roadtrips: { roadtrips: number } | null;
  tours: { tours: number } | null;
  rentals: { rentals: number; days: number } | null;
  /** `km` null when no ride of the year has a distance — unknown, never 0 (review I4). */
  bus: { rides: number; km: number | null; unmeasured: number; nights: number } | null;
}

/** Every year any visible chapter has a row in. */
export function chapterYears(rows: WrappedChapterRows): number[] {
  const { lodging, places, roadtrips, tours, rentals, bus } = rows;
  return [lodging, places, roadtrips, tours, rentals, bus].flatMap(
    (list: Array<{ year: number }> | null) => (list ?? []).map((r) => r.year)
  );
}

const inYear = <T extends { year: number }>(list: T[] | null, year: number): T[] | null =>
  list === null ? null : list.filter((r) => r.year === year);

export function buildWrappedChapters(rows: WrappedChapterRows, year: number): WrappedChapters {
  const stays = inYear(rows.lodging, year);
  const visits = inYear(rows.places, year);
  const roadtrips = inYear(rows.roadtrips, year);
  const tours = inYear(rows.tours, year);
  const rentals = inYear(rows.rentals, year);
  const bus = inYear(rows.bus, year);
  return {
    lodging:
      stays === null
        ? null
        : {
            stays: stays.length,
            nights: stays.reduce((n, s) => n + (s.nights ?? 0), 0),
            nightsUnknown: stays.filter((s) => s.nights === null).length,
          },
    places:
      visits === null
        ? null
        : { visits: visits.length, places: new Set(visits.map((v) => v.placeId)).size },
    roadtrips: roadtrips === null ? null : { roadtrips: roadtrips.length },
    tours: tours === null ? null : { tours: tours.length },
    rentals:
      rentals === null
        ? null
        : { rentals: rentals.length, days: rentals.reduce((n, r) => n + r.days, 0) },
    bus:
      bus === null
        ? null
        : {
            rides: bus.length,
            km: bus.some((r) => r.distanceKm !== null)
              ? Math.round(bus.reduce((n, r) => n + (r.distanceKm ?? 0), 0))
              : null,
            unmeasured: bus.filter((r) => r.distanceKm === null).length,
            nights: bus.reduce((n, r) => n + r.nights, 0),
          },
  };
}
