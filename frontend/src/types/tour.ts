// Frontend view of tour route sections. Mirrors backend/prisma/schema.prisma
// (`TripRoute`, `TripRouteLeg`) plus the shared vocabulary in
// backend/src/services/tour/tourDistance.ts and the DTOs the routes under
// backend/src/routes/trips/tourRoutes.ts + tourLegs.ts return. Hand-mirrored
// literal types, the same convention types/place.ts and types/lodging.ts
// already follow.
//
// Dates and JSON cross the wire as plain data, never `Date` objects.

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

export interface TourRoute {
  id: string;
  tripId: string;
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
}

export interface TourStop {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  routeOrderIdx: number | null;
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
