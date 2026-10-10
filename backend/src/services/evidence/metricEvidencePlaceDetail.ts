import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { busiestDay, busiestIndex, longestRun } from "../../shared/placeRhythm";
import type { PagingParams } from "./paging";
import { placeEvidenceEntry } from "./entryMappersDomains";
import { domainDistinctEvidence, domainSumEvidence, readYearScope } from "./domainMeasureResponse";
import { now as clockNow } from "../../shared/time/clock";
import { loadPlaceInsightPlaces } from "../stats/insights/placeInsightData";
import { prepareVisits } from "../../utils/placeInsights/prepare";
import { computeDiversity } from "../../utils/placeInsights/blocks";
import { loadScoped, type PlaceRow } from "./metricEvidencePlaces";

/**
 * The evidence behind the places tab's rhythm, quality and fun-fact cards
 * (forgejo#259): the busiest month, weekday and day, the longest run of days,
 * the rated visits, the first visit, the favourite, the categories used, the
 * northern- and southernmost place and the visits on a trip.
 *
 * The tiles fold these in the browser (`lib/stats/poiStatsDetail.ts`) over the
 * same population `loadScoped` cuts here — the year rule of
 * `shared/placeCounting.ts` — and every "which one" with a possible tie is
 * decided by `shared/placeRhythm.ts` on both sides, so the panel lists the
 * visits of the month, day or run the card names.
 *
 * A visit's month, weekday and day are read from `visitedAt`, which carries
 * the wall clock at the place: its UTC fields ARE the local calendar there, as
 * the fold reads them. An undated visit marks no month, weekday or day.
 */

type Visit = PlaceRow["visits"][number];
type Resolver = (
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
) => Promise<EvidenceResponse>;

interface DatedVisit {
  place: PlaceRow;
  visit: Visit;
  at: Date;
  day: string;
}

function datedVisits(places: readonly PlaceRow[]): DatedVisit[] {
  return places.flatMap((place) =>
    place.visits.flatMap((visit) =>
      visit.visitedAt === null
        ? []
        : [{ place, visit, at: visit.visitedAt, day: visit.visitedAt.toISOString().slice(0, 10) }]
    )
  );
}

function visitEntry(
  place: PlaceRow,
  visit: Visit,
  fields: Pick<EvidenceEntry, "contribution" | "credits" | "creditLabels" | "subtitle">
): EvidenceEntry {
  return placeEvidenceEntry(
    { id: visit.id, placeId: place.id, placeName: place.name, visitedAt: visit.visitedAt },
    fields
  );
}

const one = (d: DatedVisit): EvidenceEntry =>
  visitEntry(d.place, d.visit, { contribution: 1, subtitle: null });

/** The visits of the month (0–11) or weekday (0–6, Sunday first) holding the most. */
function busiestBucket(key: string, buckets: number, bucketOf: (at: Date) => number): Resolver {
  return async (userId, scope, page) => {
    const { visited } = await loadScoped(userId, scope, key);
    const dated = datedVisits(visited);
    const counts = new Array<number>(buckets).fill(0);
    for (const d of dated) counts[bucketOf(d.at)] += 1;
    const best = busiestIndex(counts);
    const entries = best === null ? [] : dated.filter((d) => bucketOf(d.at) === best).map(one);
    return domainSumEvidence({ key, unit: "visits", scope, page, entries, value: entries.length });
  };
}

export const resolvePlaceBusiestMonthVisits = busiestBucket("placeBusiestMonthVisits", 12, (at) =>
  at.getUTCMonth()
);

export const resolvePlaceBusiestWeekdayVisits = busiestBucket(
  "placeBusiestWeekdayVisits",
  7,
  (at) => at.getUTCDay()
);

/** The places of the day with the most distinct places — a place twice that day is one. */
export const resolvePlaceBusiestDayPlaces: Resolver = async (userId, scope, page) => {
  const key = "placeBusiestDayPlaces";
  const { visited } = await loadScoped(userId, scope, key);
  const dated = datedVisits(visited);
  const perDay = new Map<string, Set<string>>();
  for (const d of dated) perDay.set(d.day, (perDay.get(d.day) ?? new Set()).add(d.place.id));
  const best = busiestDay(perDay);
  const entries = dated
    .filter((d) => d.day === best?.date)
    .map((d) =>
      visitEntry(d.place, d.visit, {
        credits: [d.place.id],
        creditLabels: { [d.place.id]: d.place.name },
        subtitle: null,
      })
    );
  return domainDistinctEvidence({ key, unit: "places", scope, page, entries });
};

/** The visits on the days of the longest run; the unit is the DAY, so two visits on one day count once. */
export const resolvePlaceLongestStreakDays: Resolver = async (userId, scope, page) => {
  const key = "placeLongestStreakDays";
  const { visited } = await loadScoped(userId, scope, key);
  const dated = datedVisits(visited);
  const run = longestRun(dated.map((d) => d.day));
  const entries = run
    ? dated
        .filter((d) => d.day >= run.first && d.day <= run.last)
        .map((d) => visitEntry(d.place, d.visit, { credits: [d.day], subtitle: null }))
    : [];
  return domainDistinctEvidence({ key, unit: "days", scope, page, entries });
};

/** Rated visits only — an unrated visit is not a zero and is not listed. */
export const resolvePlaceRatedVisitCount: Resolver = async (userId, scope, page) => {
  const key = "placeRatedVisitCount";
  const { visited } = await loadScoped(userId, scope, key);
  const entries = visited.flatMap((place) =>
    place.visits
      .filter((visit) => typeof visit.rating === "number")
      .map((visit) =>
        visitEntry(place, visit, {
          contribution: 1,
          subtitle: { key: "evidence.subtitle.rating", values: { rating: visit.rating as number } },
        })
      )
  );
  return domainSumEvidence({ key, unit: "visits", scope, page, entries, value: entries.length });
};

/** The earliest dated visit — several, only when they share the very same instant. */
export const resolvePlaceFirstVisit: Resolver = async (userId, scope, page) => {
  const key = "placeFirstVisit";
  const { visited } = await loadScoped(userId, scope, key);
  const dated = datedVisits(visited);
  const first = Math.min(...dated.map((d) => d.at.getTime()));
  const entries = dated.filter((d) => d.at.getTime() === first).map(one);
  return domainSumEvidence({ key, unit: "visits", scope, page, entries, value: entries.length });
};

/**
 * The visits of the place returned to most often: most visits, then the name
 * (the fold's order). The card is drawn only from two visits on.
 */
export const resolvePlaceFavouriteVisits: Resolver = async (userId, scope, page) => {
  const key = "placeFavouriteVisits";
  const { visited } = await loadScoped(userId, scope, key);
  const [favourite] = visited
    .filter((place) => place.visits.length > 0)
    .sort((a, b) => b.visits.length - a.visits.length || a.name.localeCompare(b.name));
  const entries = favourite
    ? favourite.visits.map((visit) =>
        visitEntry(favourite, visit, { contribution: 1, subtitle: null })
      )
    : [];
  return domainSumEvidence({ key, unit: "visits", scope, page, entries, value: entries.length });
};

/** Every counted place, crediting its category: the union is the categories used. */
export const resolvePlaceCategoriesUsedCount: Resolver = async (userId, scope, page) => {
  const key = "placeCategoriesUsedCount";
  const { visited } = await loadScoped(userId, scope, key);
  const entries = visited.map((place) =>
    placeEvidenceEntry(
      { id: place.id, placeId: place.id, placeName: place.name, visitedAt: newest(place) },
      { credits: [place.category], subtitle: null }
    )
  );
  return domainDistinctEvidence({ key, unit: "categories", scope, page, entries });
};

function newest(place: PlaceRow): Date | null {
  let at: Date | null = null;
  for (const visit of place.visits) {
    if (visit.visitedAt !== null && (at === null || visit.visitedAt > at)) at = visit.visitedAt;
  }
  return at;
}

/** The place(s) at the extreme latitude — usually one; every place on that exact latitude. */
function extremeLatitude(key: string, pick: (lats: number[]) => number): Resolver {
  return async (userId, scope, page) => {
    const { visited } = await loadScoped(userId, scope, key);
    const target = visited.length > 0 ? pick(visited.map((p) => p.lat)) : null;
    const entries = visited
      .filter((place) => place.lat === target)
      .map((place) =>
        placeEvidenceEntry(
          { id: place.id, placeId: place.id, placeName: place.name, visitedAt: newest(place) },
          { credits: [place.id], creditLabels: { [place.id]: place.name }, subtitle: null }
        )
      );
    return domainDistinctEvidence({ key, unit: "places", scope, page, entries });
  };
}

export const resolvePlaceNorthernmost = extremeLatitude("placeNorthernmost", (lats) =>
  Math.max(...lats)
);
export const resolvePlaceSouthernmost = extremeLatitude("placeSouthernmost", (lats) =>
  Math.min(...lats)
);

/** Visits filed on a trip, out of the counted visits — a visit, not a place, belongs to a trip. */
export const resolvePlaceVisitsOnTripsCount: Resolver = async (userId, scope, page) => {
  const key = "placeVisitsOnTripsCount";
  const { visited } = await loadScoped(userId, scope, key);
  const entries = visited.flatMap((place) =>
    place.visits
      .filter((visit) => visit.tripId !== null)
      .map((visit) => visitEntry(place, visit, { contribution: 1, subtitle: null }))
  );
  return domainSumEvidence({ key, unit: "visits", scope, page, entries, value: entries.length });
};

/**
 * The most varied trip of the period (the "Vielfalt je Reise" tile): the first
 * trip with the most categories in `computeDiversity`'s order, among trips
 * filed in the year when one is chosen. Its visits credit their place's
 * category, so the union is the figure.
 */
export const resolvePlaceVarietyTripCategories: Resolver = async (userId, scope, page) => {
  const key = "placeVarietyTripCategories";
  const year = readYearScope(scope, key);
  const { counted, countedPlaces } = prepareVisits(
    await loadPlaceInsightPlaces(userId),
    clockNow()
  );
  const trips = computeDiversity(counted, countedPlaces).trips.filter(
    (t) => year === undefined || t.year === year
  );
  const top = trips.reduce<(typeof trips)[number] | null>(
    (best, t) => (best === null || t.categories.length > best.categories.length ? t : best),
    null
  );
  const entries = counted
    .filter((v) => top !== null && v.visit.trip?.id === top.tripId)
    .map((v) =>
      placeEvidenceEntry(
        {
          id: v.visit.id,
          placeId: v.place.id,
          placeName: v.place.name,
          visitedAt: v.visit.visitedAt,
        },
        { credits: [v.place.category], subtitle: { text: top?.tripName ?? "" } }
      )
    );
  return domainDistinctEvidence({ key, unit: "categories", scope, page, entries });
};

export const PLACE_DETAIL_RESOLVERS: Record<string, Resolver> = {
  placeBusiestMonthVisits: resolvePlaceBusiestMonthVisits,
  placeBusiestWeekdayVisits: resolvePlaceBusiestWeekdayVisits,
  placeBusiestDayPlaces: resolvePlaceBusiestDayPlaces,
  placeLongestStreakDays: resolvePlaceLongestStreakDays,
  placeRatedVisitCount: resolvePlaceRatedVisitCount,
  placeFirstVisit: resolvePlaceFirstVisit,
  placeFavouriteVisits: resolvePlaceFavouriteVisits,
  placeCategoriesUsedCount: resolvePlaceCategoriesUsedCount,
  placeNorthernmost: resolvePlaceNorthernmost,
  placeSouthernmost: resolvePlaceSouthernmost,
  placeVisitsOnTripsCount: resolvePlaceVisitsOnTripsCount,
  placeVarietyTripCategories: resolvePlaceVarietyTripCategories,
};
