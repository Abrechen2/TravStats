import { zoneOf } from "../../../shared/time/zoneOf";
import { contains, distanceToArea, polygons, type MarketArea } from "./geometry";
import type { MarketVisit } from "./detect";
export interface KnownPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  externalRef?: string | null;
  wikidataId?: string | null;
}
export interface KnownVisit {
  id: string;
  placeId: string;
  tripId: string | null;
  visitedAt: string | null;
  visitedAtUtc: string | null;
  visitedPrecision: string | null;
}
export interface KnownTrip {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
}
const normalized = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]/gu, "");
const localDay = (date: Date, zone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/** Identity may also come from an existing OSM/Wikidata import, regardless of translated name. */
export function matchesMarketPlace(p: KnownPlace, area: MarketArea): boolean {
  const identity =
    normalized(p.name) === normalized(area.name) ||
    p.externalRef === `osm:${area.id}` ||
    (!!p.wikidataId && area.entityRef === `wikidata:${p.wikidataId}`);
  return identity && (contains(area, p.lon, p.lat) || distanceToArea(area, p.lon, p.lat) <= 20);
}

/** Correlate only. A shop inside a market is NOT an already-recorded market visit. */
export function previewMarketVisit(
  candidate: MarketVisit,
  area: MarketArea,
  known: {
    places: readonly KnownPlace[];
    visits: readonly KnownVisit[];
    trips: readonly KnownTrip[];
  }
) {
  const [lon, lat] = polygons(area)[0][0][0];
  const zone = zoneOf({ lat, lon });
  if (!zone) throw new Error("Market timezone is unresolved");
  const startDay = localDay(candidate.startAt, zone),
    endDay = localDay(candidate.endAt, zone);
  const ownPlaces = known.places.filter((p) => matchesMarketPlace(p, area));
  const ownIds = new Set(ownPlaces.map((p) => p.id));
  const matching = known.visits.filter((v) => {
    if (!ownIds.has(v.placeId)) return false;
    if (v.visitedPrecision === "day" && v.visitedAt) {
      const day = v.visitedAt.slice(0, 10);
      return day >= startDay && day <= endDay;
    }
    // Unknown legacy/floating minute times require manual review.
    const instant = v.visitedAtUtc ? Date.parse(v.visitedAtUtc) : NaN;
    return (
      Number.isFinite(instant) &&
      instant >= candidate.startAt.getTime() - 10 * 60_000 &&
      instant <= candidate.endAt.getTime() + 10 * 60_000
    );
  });
  const overlapping = known.trips.filter(
    (t) =>
      t.startDate &&
      t.endDate &&
      t.startDate.slice(0, 10) <= endDay &&
      t.endDate.slice(0, 10) >= startDay
  );
  const trip =
    overlapping.length === 1 &&
    overlapping[0].startDate!.slice(0, 10) <= startDay &&
    overlapping[0].endDate!.slice(0, 10) >= endDay
      ? overlapping[0]
      : null;
  return {
    ...candidate,
    zone,
    localStart: new Intl.DateTimeFormat("sv-SE", {
      timeZone: zone,
      dateStyle: "short",
      timeStyle: "medium",
    }).format(candidate.startAt),
    localEnd: new Intl.DateTimeFormat("sv-SE", {
      timeZone: zone,
      dateStyle: "short",
      timeStyle: "medium",
    }).format(candidate.endAt),
    status:
      matching.length === 1 ? "alreadyRecorded" : matching.length > 1 ? "reviewConflict" : "review",
    existingVisitIds: matching.map((v) => v.id),
    tripId: trip?.id ?? null,
    tripName: trip?.name ?? null,
    uncertainties: [
      ...candidate.uncertainties,
      ...(overlapping.length > 1 ? ["tripAmbiguous"] : []),
    ],
  };
}
