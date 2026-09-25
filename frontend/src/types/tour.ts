// Frontend view of tour route sections. Mirrors backend/prisma/schema.prisma
// (`TripRoute`, `TripRouteLeg`) plus the shared vocabulary in
// backend/src/services/tour/tourDistance.ts and the DTOs the routes under
// backend/src/routes/trips/tourRoutes.ts + tourLegs.ts return. Hand-mirrored
// literal types, the same convention types/place.ts and types/lodging.ts
// already follow.
//
// Dates and JSON cross the wire as plain data, never `Date` objects.

import type { RouteKind, RoadtripVehicle, TourActivity } from "../shared/tour/roadtrip";

/**
 * The full leg-source vocabulary. The API only accepts `straight` and
 * `drawn` today (phase 1) — `routed` and `track` already exist here so a
 * later phase adds a value to the server's allow-list, not a migration of
 * this union. See `backend/src/schemas/tour.ts`'s `PHASE_1_SOURCES` note.
 */
export const LEG_SOURCES = ["straight", "drawn", "routed", "track"] as const;
export type LegSource = (typeof LEG_SOURCES)[number];

export const LEG_MODES = ["road", "ferry", "rail", "foot", "bike"] as const;
export type LegMode = (typeof LEG_MODES)[number];

/**
 * The modes a NEW leg or section may be created with.
 *
 * "rail" is not among them since 2026-09-21 and is still a perfectly valid
 * stored value — the two lists exist precisely so that withdrawing an offer
 * does not invalidate data somebody already has. Alex, 2026-09-20: a train
 * journey deserves the real thing, a domain with an API that can draw the
 * line the train actually took, rather than a tour mode that can only draw
 * a road detour around the track. Owner agreed the same evening. Put it
 * back here the day that domain does NOT happen.
 */
export const SELECTABLE_LEG_MODES = LEG_MODES.filter((mode) => mode !== "rail");

/**
 * Leg modes a routing provider can meaningfully answer. Mirrors
 * `RoutableMode`/`isRoutableMode` in
 * `backend/src/services/tour/routing/types.ts` — ferry and rail are
 * excluded there by design (a road router either detours around water it
 * cannot cross, or invents a path a train never takes), so the frontend
 * must never offer "routed" as an option for those two modes either.
 */
export const ROUTABLE_LEG_MODES = ["road", "foot", "bike"] as const;
export type RoutableLegMode = (typeof ROUTABLE_LEG_MODES)[number];

export function isRoutableLegMode(mode: LegMode): mode is RoutableLegMode {
  return (ROUTABLE_LEG_MODES as readonly LegMode[]).includes(mode);
}

/**
 * Mirrors `RoutingProviderId`/`ROUTING_PROVIDER_IDS` in
 * `backend/src/services/tour/routing/types.ts` — which routing provider an
 * admin can select for the whole instance.
 */
export const ROUTING_PROVIDER_IDS = ["openrouteservice", "graphhopper", "custom"] as const;
export type RoutingProviderId = (typeof ROUTING_PROVIDER_IDS)[number];

export interface TourRoute {
  id: string;
  /** `null` for a standalone tour — one that belongs to no trip. */
  tripId: string | null;
  name: string;
  mode: LegMode;
  orderIdx: number;
  color: string | null;
  notes: string | null;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  stopCount: number;
  legCount: number;
  distanceKm: number;
  drivenKm: number;
  /** "tour" (a day trip) or "roadtrip" (the 2.7 domain). */
  kind: RouteKind;
  activity: TourActivity | null;
  vehicle: RoadtripVehicle | null;
  vehicleName: string | null;
  /** Tour only: the roadtrip station the day tour set out from. */
  anchorStopId: string | null;
  /** Set on rows the 2.7 migration classified by rule, until confirmed or switched. */
  kindAssignedAutomatically: boolean;
}

export interface TourStop {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  routeOrderIdx: number | null;
  /** Returned by every read and write of a section's stops; optional so a
   *  stop built locally need not invent one. */
  notes?: string | null;
}

export interface TourLeg {
  id: string;
  fromStopId: string;
  toStopId: string;
  distanceKm: number;
  source: LegSource;
  mode: LegMode;
  confidence: string;
  waypoints: Array<[number, number]> | null;
  drivingMinutes: number | null;
  tollCost: number | null;
  currency: string | null;
}

/**
 * One leg's rendered line. There is NO `order` property — the server
 * (`GET .../geometry` in `backend/src/routes/trips/tourLegs.ts`) already
 * returns features ordered by `fromStop.routeOrderIdx`, so the itinerary
 * order is the array order and nothing here needs to carry it twice.
 */
export interface TourGeometryFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Array<[number, number]> };
  properties: {
    legId: string;
    source: LegSource;
    mode: LegMode;
    confidence: string;
    distanceKm: number;
  };
}

export interface TourGeometry {
  type: "FeatureCollection";
  features: TourGeometryFeature[];
}

/**
 * `TripRouteTrack.source` vocabulary (phase 3b). Mirrors `TRACK_SOURCES` in
 * `backend/src/schemas/tour.ts`: `gpx` (an uploaded GPX file) and `dawarich`
 * (pulled from a Dawarich connection). Distinct from `LegSource` — a track
 * is the RECORDING, `"track"` (a `LegSource`) is a LEG that adopted a
 * segment of one.
 */
// Since 2.7 also `fit`/`tcx` (file formats) and `strava`/`healthkit`/`healthconnect` (where an
// imported recording came from).
export const TRACK_SOURCES = [
  "gpx",
  "dawarich",
  "fit",
  "tcx",
  "strava",
  "healthkit",
  "healthconnect",
] as const;
export type TrackSource = (typeof TRACK_SOURCES)[number];

/**
 * Metadata for one recorded track, WITHOUT its geometry — the shape
 * `GET .../tracks` returns (list call). Mirrors `TrackMetaRow`/
 * `toTrackMetaDto` in `backend/src/routes/trips/tourTracks.ts`. Dates cross
 * the wire as ISO strings, never `Date` objects, the same convention every
 * other type in this file follows.
 */
export interface TourTrackMeta {
  id: string;
  routeId: string;
  source: TrackSource;
  /** Always comes from inside the GPX (or `null` for a Dawarich pull) —
   *  there is no name override in the API, so no UI here builds one. */
  name: string | null;
  startedAt: string;
  endedAt: string;
  pointCount: number;
  distanceKm: number;
  /** True when a Dawarich pull was cut short by the server's page cap — the
   *  stored track covers only the newest slice of the requested window, so
   *  `distanceKm` is a PARTIAL measurement. Always `false` for `source:
   *  "gpx"`, which refuses an oversized file outright instead. */
  truncated: boolean;
  /** Climb in metres, measured on the raw points; null without elevation. */
  ascentM: number | null;
  descentM: number | null;
  /** Time actually moving; null when the points carry no times. */
  movingSeconds: number | null;
  externalRef: string | null;
  createdAt: string;
}

/**
 * One track WITH its simplified geometry — the shape
 * `GET .../tracks/:trackId` returns. `geometry` is `[lon, lat]` tuples in
 * travel order, the same GeoJSON coordinate order every other geometry in
 * this file uses.
 */
export interface TourTrack extends TourTrackMeta {
  geometry: Array<[number, number]>;
  /** Raw running distance per geometry vertex. Null on old rows. */
  cumulativeKm: number[] | null;
  /** `[km, metres]` sampled from the raw points; null when the source had none. */
  elevationProfile: Array<[number, number]> | null;
}
