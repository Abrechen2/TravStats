import type { Prisma, TripRoute, TripRouteLeg, TripStop } from "../../../prisma";
import { pickFacts } from "./pick";

/**
 * A roadtrip's facts (forgejo#404, spec 2026-10-17 §6.8): its name, vehicle
 * and default mode. Private: notes, tags, the map colour, odometer readings,
 * expenses and recorded tracks — none of which is a column here.
 */
export const ROADTRIP_FACT_FIELDS = [
  "name",
  "mode",
  "orderIdx",
  "vehicle",
  "vehicleName",
] as const satisfies readonly (keyof TripRoute)[];
export type RoadtripFactField = (typeof ROADTRIP_FACT_FIELDS)[number];

export function roadtripFacts(row: Pick<TripRoute, RoadtripFactField>) {
  return pickFacts(
    row,
    ROADTRIP_FACT_FIELDS
  ) satisfies Partial<Prisma.TripRouteUncheckedCreateInput>;
}

/**
 * A station: what and where, when, and whether a night was spent. Private: the
 * notes; `placeId` names a place of the sharer's own. The stay a station names
 * (`lodgingStayRef`) travels as a reference by share key, as for a timeline
 * stop. `key` is the station's own share key — the identity that survives
 * reordering, which the route position does not.
 */
export const ROADTRIP_STATION_FACT_FIELDS = [
  "routeOrderIdx",
  "orderIdx",
  "domain",
  "title",
  "description",
  "startDate",
  "endDate",
  "lat",
  "lon",
  "startUtc",
  "endUtc",
  "stopZone",
  "precision",
  "overnight",
  "viaPoint",
  "countryVisitKind",
] as const satisfies readonly (keyof TripStop)[];
export type RoadtripStationFactField = (typeof ROADTRIP_STATION_FACT_FIELDS)[number];

export function roadtripStationFacts(row: Pick<TripStop, RoadtripStationFactField>) {
  return pickFacts(
    row,
    ROADTRIP_STATION_FACT_FIELDS
  ) satisfies Partial<Prisma.TripStopUncheckedCreateInput>;
}

/**
 * A leg's computed figures, keyed by its two endpoint stations' share keys.
 * One route, one set of kilometres: copying them lets the recipient's totals
 * match without routing again.
 */
export const ROADTRIP_LEG_FACT_FIELDS = [
  "distanceKm",
  "source",
  "mode",
  "confidence",
  "waypoints",
  "drivingMinutes",
] as const satisfies readonly (keyof TripRouteLeg)[];
export type RoadtripLegFactField = (typeof ROADTRIP_LEG_FACT_FIELDS)[number];
