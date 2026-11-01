/**
 * The year in review beyond flights, cruises and rail (forgejo#265): one
 * chapter per further domain the user sees — stays, places, roadtrips, day
 * tours, rentals, bus rides, ferry crossings. Each row arrives already COUNTED and FILED by its
 * domain's own rule (the loader, `wrappedDomains.ts`, asks `lodgingCounting`,
 * `placeCounting`, `rentalCounting`, `busCounting`, `ferryCounting`, …); this module only folds
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
/** A roadtrip filed under its first station's year (forgejo#405). */
export interface WrappedRoadtripRow extends WrappedYearRow {
  /** Every leg together; null when the roadtrip has no leg — unknown, never 0. */
  km?: number | null;
  /** Its nights; null when the record does not say them all (see `nightsKnown`). */
  nights?: number | null;
}
/** A day tour (forgejo#405). */
export interface WrappedTourRow extends WrappedYearRow {
  /** Its recording's distance, else its legs'; null when it has neither — never 0. */
  km?: number | null;
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
export interface WrappedFerryRow extends WithEntry {
  year: number;
  distanceKm: number | null;
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
  roadtrips: WrappedRoadtripRow[] | null;
  tours: WrappedTourRow[] | null;
  rentals: WrappedRentalRow[] | null;
  bus: WrappedBusRow[] | null;
  /** Optional: a caller that predates the ferry chapter answers without it — no chapter. */
  ferry?: WrappedFerryRow[] | null;
}

export const NO_CHAPTERS: WrappedChapterRows = {
  lodging: null,
  places: null,
  roadtrips: null,
  tours: null,
  rentals: null,
  bus: null,
  ferry: null,
};

export interface WrappedChapters {
  lodging: { stays: number; nights: number; nightsUnknown: number } | null;
  places: { visits: number; places: number } | null;
  /**
   * `km` null when no roadtrip of the year has a leg; `nights` sums the
   * roadtrips whose nights are fully known and `nightsUnknown` counts the rest
   * (the stays' rule) — a lower bound is never presented as the figure.
   */
  roadtrips: {
    roadtrips: number;
    km: number | null;
    unmeasured: number;
    nights: number;
    nightsUnknown: number;
  } | null;
  /** `km` null when no tour of the year was measured. */
  tours: { tours: number; km: number | null; unmeasured: number } | null;
  rentals: { rentals: number; days: number } | null;
  /** `km` null when no ride of the year has a distance — unknown, never 0 (review I4). */
  bus: { rides: number; km: number | null; unmeasured: number; nights: number } | null;
  /** Same abstention as `bus`: `km` null when no crossing of the year has a distance. */
  ferry: { crossings: number; km: number | null; unmeasured: number } | null;
}

/** Every year any visible chapter has a row in. */
export function chapterYears(rows: WrappedChapterRows): number[] {
  const { lodging, places, roadtrips, tours, rentals, bus, ferry = null } = rows;
  return [lodging, places, roadtrips, tours, rentals, bus, ferry].flatMap(
    (list: Array<{ year: number }> | null) => (list ?? []).map((r) => r.year)
  );
}

/** The rows' kilometres together, rounded; null when none of them has any. */
const sumKm = (rows: ReadonlyArray<{ km?: number | null }>): number | null =>
  rows.some((r) => (r.km ?? null) !== null)
    ? Math.round(rows.reduce((n, r) => n + (r.km ?? 0), 0))
    : null;

const inYear = <T extends { year: number }>(list: T[] | null, year: number): T[] | null =>
  list === null ? null : list.filter((r) => r.year === year);

export function buildWrappedChapters(rows: WrappedChapterRows, year: number): WrappedChapters {
  const stays = inYear(rows.lodging, year);
  const visits = inYear(rows.places, year);
  const roadtrips = inYear(rows.roadtrips, year);
  const tours = inYear(rows.tours, year);
  const rentals = inYear(rows.rentals, year);
  const bus = inYear(rows.bus, year);
  const ferry = inYear(rows.ferry ?? null, year);
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
    roadtrips:
      roadtrips === null
        ? null
        : {
            roadtrips: roadtrips.length,
            km: sumKm(roadtrips),
            unmeasured: roadtrips.filter((r) => (r.km ?? null) === null).length,
            nights: roadtrips.reduce((n, r) => n + (r.nights ?? 0), 0),
            nightsUnknown: roadtrips.filter((r) => (r.nights ?? null) === null).length,
          },
    tours:
      tours === null
        ? null
        : {
            tours: tours.length,
            km: sumKm(tours),
            unmeasured: tours.filter((r) => (r.km ?? null) === null).length,
          },
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
    ferry:
      ferry === null
        ? null
        : {
            crossings: ferry.length,
            km: ferry.some((r) => r.distanceKm !== null)
              ? Math.round(ferry.reduce((n, r) => n + (r.distanceKm ?? 0), 0))
              : null,
            unmeasured: ferry.filter((r) => r.distanceKm === null).length,
          },
  };
}
