import { AppError } from "../../middleware/errorHandler";
import { prisma } from "../../db";
import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { classifyPlace, classifyVisit, visitCountsForYear } from "../../shared/placeCounting";
import type { PagingParams } from "./paging";
import { placeEvidenceEntry } from "./entryMappersDomains";
import { domainDistinctEvidence, domainSumEvidence, readYearScope } from "./domainMeasureResponse";

/**
 * The six served places-tab measures (task 7b-3).
 *
 * The calculator here is a CLIENT fold — `lib/stats/poiStatsDetail.ts`'s
 * `derivePoiStats` over `listPlaces` — because there is no `/stats/poi`
 * rollup to defer to. So there is no endpoint for the cross-check to compare
 * against, and the guard is the one the fold itself rests on:
 * `shared/placeCounting.ts` decides what counts, and both sides read it. The
 * year window moved into that module in this task for the same reason — it
 * lived only in `lib/stats/periodScope.ts`, and a second copy of a year
 * window is how a panel comes to name a visit the tile never counted.
 *
 * WHAT AN UNDATED VISIT DOES AND DOES NOT DO decides half of what is below,
 * exactly as it does in the fold: it counts towards totals — it happened, the
 * user just cannot say when — and it marks no year. So the lifetime view
 * holds it and no year may claim it.
 */

/** Only the columns these six measures read; visits come with their place. */
const PLACE_SELECT = {
  id: true,
  name: true,
  city: true,
  isoCountryCode: true,
  visited: true,
  visits: { select: { id: true, visitedAt: true } },
} as const;

type PlaceRow = {
  id: string;
  name: string;
  city: string | null;
  isoCountryCode: string | null;
  visited: boolean;
  visits: Array<{ id: string; visitedAt: Date | null }>;
};

interface ScopedPlaces {
  /** Every place the user has, with the visits that count in this scope. */
  all: PlaceRow[];
  /** The places that count as visited, already cut to the scope. */
  visited: PlaceRow[];
}

/**
 * The scoped population, cut exactly as `placesVisitedIn` cuts it: a place
 * belongs to a year when a visit that HAPPENED is dated in it, and it carries
 * only that year's visits. Three things stay out of a year on purpose — a
 * wishlist entry, which has a state and no date; a place marked visited with
 * no dated visit, which happened but which nobody can place; and a visit dated
 * later this year, which has not happened yet.
 */
async function loadScoped(
  userId: string,
  scope: EvidenceScope,
  key: string
): Promise<ScopedPlaces> {
  const year = readYearScope(scope, key);
  const rows = (await prisma.place.findMany({
    where: { userId },
    select: PLACE_SELECT,
  })) as PlaceRow[];

  if (year === undefined) {
    return {
      all: rows,
      visited: rows
        .filter((place) => classifyPlace(place) === "visited")
        .map((place) => ({
          ...place,
          visits: place.visits.filter((visit) => classifyVisit(visit) === "visited"),
        })),
    };
  }

  const scoped = rows
    .filter((place) => classifyPlace(place) === "visited")
    .map((place) => ({
      ...place,
      visits: place.visits.filter((visit) => visitCountsForYear(visit, year)),
    }))
    .filter((place) => place.visits.length > 0);
  return { all: rows, visited: scoped };
}

/**
 * A place as evidence. Its own id is the evidence — the fold counts PLACES
 * here, not visits — and the date is the newest counted visit, which is an
 * ORDERING choice: the panel sorts by date, and a place marked visited with
 * no dated visit has none to give.
 */
function placeEntry(
  place: PlaceRow,
  fields: Partial<Pick<EvidenceEntry, "contribution" | "credits" | "creditLabels">>
): EvidenceEntry {
  let newest: Date | null = null;
  for (const visit of place.visits) {
    if (visit.visitedAt !== null && (newest === null || visit.visitedAt > newest)) {
      newest = visit.visitedAt;
    }
  }
  return placeEvidenceEntry(
    { id: place.id, placeId: place.id, placeName: place.name, visitedAt: newest },
    { ...fields, subtitle: null }
  );
}

/**
 * Places that count as visited. Three visits to one McDonald's are ONE place.
 *
 * The credit is the place's OWN id, because that is what makes the union
 * count places rather than names — two places both called "Hafen" are two.
 * The id is a UUID, so the row also carries the name to print: the panel read
 * "belegt: 34481a44-b245-…" on the demo account until 2026-09-19.
 */
export async function resolvePlacesVisitedCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "placesVisitedCount";
  const { visited } = await loadScoped(userId, scope, key);
  const entries = visited.map((place) =>
    placeEntry(place, { credits: [place.id], creditLabels: { [place.id]: place.name } })
  );
  return domainDistinctEvidence({ key, unit: "places", scope, page, entries });
}

/**
 * Visits, not places — the other half of the split the Place/PlaceVisit tables
 * exist to make (#177). The entry is the VISIT: it has an id of its own, and
 * three trips to one place are three pieces of evidence. It has no page, so
 * the link targets its place, which is the same distinction a lodging stay
 * already makes.
 */
export async function resolvePlaceVisitCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "placeVisitCount";
  const { visited } = await loadScoped(userId, scope, key);
  const entries = visited.flatMap((place) =>
    place.visits.map((visit) =>
      placeEvidenceEntry(
        { id: visit.id, placeId: place.id, placeName: place.name, visitedAt: visit.visitedAt },
        { contribution: 1, subtitle: null }
      )
    )
  );
  const total = entries.length;
  return domainSumEvidence({ key, unit: "visits", scope, page, entries, value: total });
}

/**
 * Countries, joined on the DERIVED `isoCountryCode` and never the free-text
 * `country` — "Deutschland" and "Germany" are one country, and only the code
 * knows that. A place the geocoder could not place credits nothing and stays
 * in the list.
 */
export async function resolvePlaceCountriesCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "placeCountriesCount";
  const { visited } = await loadScoped(userId, scope, key);
  const entries = visited.map((place) =>
    placeEntry(place, {
      credits: place.isoCountryCode ? [place.isoCountryCode.toUpperCase()] : [],
    })
  );
  return domainDistinctEvidence({ key, unit: "countries", scope, page, entries });
}

/** Cities, by the name the geocoder wrote — there is no code for a city. */
export async function resolvePlaceCitiesCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "placeCitiesCount";
  const { visited } = await loadScoped(userId, scope, key);
  const entries = visited.map((place) =>
    placeEntry(place, { credits: place.city ? [place.city] : [] })
  );
  return domainDistinctEvidence({ key, unit: "cities", scope, page, entries });
}

/**
 * Lists and the wishlist answer for the WHOLE logbook and for no year: a list
 * is what the user KEEPS, and a wishlist entry has a state rather than a date.
 * `PoiStatsSection` draws both tiles only when no year is selected, which is
 * why the registry scopes them `allTime` alone and why a year here is a 400
 * rather than a lifetime answer wearing a year's label.
 */
function requireAllTime(scope: EvidenceScope, key: string): void {
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `${key} evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }
}

/**
 * Every list the user has, their own and the checklists they subscribed to —
 * one row in the same table, which is why a user who follows two checklists
 * and made none of their own reads "2" rather than a discouraging "0".
 */
export async function resolvePlaceListCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "placeListCount";
  requireAllTime(scope, key);
  const lists = await prisma.placeList.findMany({
    where: { userId },
    select: { id: true, name: true, curatedKey: true, createdAt: true },
  });
  const entries: EvidenceEntry[] = lists.map((list) => ({
    domain: "place",
    id: list.id,
    // A subscribed checklist is read at its own route, keyed by the curated
    // key rather than by the subscription row's id.
    href: list.curatedKey ? `/places/checklists/${list.curatedKey}` : `/places/lists/${list.id}`,
    title: { text: list.name },
    subtitle: null,
    date: { value: list.createdAt.toISOString().slice(0, 10), precision: "day" },
    contribution: 1,
  }));
  return domainSumEvidence({ key, unit: "lists", scope, page, entries, value: entries.length });
}

/**
 * Places the user means to go to, not ones they have been to. The fold reads
 * it as `places.length - visitedPlaces.length`, so a place with a dated FUTURE
 * visit is in here too — it is planned, and planned is not visited.
 */
export async function resolvePlaceWishlistCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "placeWishlistCount";
  requireAllTime(scope, key);
  const { all } = await loadScoped(userId, scope, key);
  const entries = all
    .filter((place) => classifyPlace(place) !== "visited")
    .map((place) => placeEntry(place, { contribution: 1 }));
  return domainSumEvidence({ key, unit: "places", scope, page, entries, value: entries.length });
}
