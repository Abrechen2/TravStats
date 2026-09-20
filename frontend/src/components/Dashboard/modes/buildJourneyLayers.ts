import { ArcLayer, PathLayer } from "@deck.gl/layers";
import {
  calculateDistance,
  getArcPeakAltitudeMeters,
  getArcSteps,
  greatCircleWaypoints,
} from "../../Globe/arcUtils";
import type { Layer } from "@deck.gl/core";
import { createCruiseArcsLayer, createCruiseArrowsLayer } from "../../layers/cruiseArcsLayer";
import type { CruiseColorConfig } from "../../../lib/cruiseColor";
import type { GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Same value and same reason as `TOUR_PATH_GLOBE_ALTITUDE_M` — high enough to
 * clear the chord sag of a long leg, low enough to be invisible as height.
 */
export const JOURNEY_GLOBE_ALTITUDE_M = 5_000;

export interface TripGroup {
  flights: GeoJSONFeature[];
  cruises: Cruise[];
}

// ---------------------------------------------------------------------------
// Grouping helper
// ---------------------------------------------------------------------------

/**
 * Extract `tripId` from a GeoJSON feature's properties. The /geo endpoint
 * exposes it; missing or empty-string values are treated the same as `null`.
 */
function featureTripId(f: GeoJSONFeature): string | null {
  const tid = f.properties?.tripId;
  return typeof tid === "string" && tid.length > 0 ? tid : null;
}

/**
 * Partition a mixed set of GeoJSON flight features and cruise records by
 * their shared `tripId`.  Entries without a `tripId` (or whose `tripId` is
 * an empty string) are silently discarded so the caller never sees orphan
 * data.
 */
export function groupByTripId(
  flights: readonly GeoJSONFeature[],
  cruises: readonly Cruise[]
): Record<string, TripGroup> {
  const out: Record<string, TripGroup> = {};

  for (const f of flights) {
    const tid = featureTripId(f);
    if (tid === null) continue;
    if (!out[tid]) out[tid] = { flights: [], cruises: [] };
    out[tid].flights.push(f);
  }

  for (const c of cruises) {
    if (!c.tripId) continue;
    if (!out[c.tripId]) out[c.tripId] = { flights: [], cruises: [] };
    out[c.tripId].cruises.push(c);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Flight arc geometry extraction
// ---------------------------------------------------------------------------

/** Amber, so a flight leg reads apart from the cruise sky-blue beside it. */
const JOURNEY_FLIGHT_COLOR: [number, number, number, number] = [245, 158, 11, 220];

interface JourneyFlightPath {
  path: [number, number, number][];
}

/**
 * The same great circle the globe's own arcs ride, at the same altitude rule:
 * the peak scales with the leg, and BOTH ends sit on the surface — an arc that
 * starts in the air is not an arc.
 */
function toGreatCirclePath(row: FlightArcRow): JourneyFlightPath {
  const from: [number, number] = [row.sourceLon, row.sourceLat];
  const to: [number, number] = [row.targetLon, row.targetLat];
  const distanceKm = calculateDistance(row.sourceLat, row.sourceLon, row.targetLat, row.targetLon);
  return {
    path: greatCircleWaypoints(
      from,
      to,
      getArcPeakAltitudeMeters(distanceKm),
      getArcSteps(distanceKm, false)
    ),
  };
}

interface FlightArcRow {
  sourceLon: number;
  sourceLat: number;
  targetLon: number;
  targetLat: number;
}

function flightToArcRow(f: GeoJSONFeature): FlightArcRow | null {
  const geom = f.geometry;
  if (geom.type !== "LineString" || geom.coordinates.length < 2) return null;

  const start = geom.coordinates[0];
  const end = geom.coordinates[geom.coordinates.length - 1];

  const [lonA, latA] = start as [unknown, unknown];
  const [lonB, latB] = end as [unknown, unknown];

  if (
    typeof lonA !== "number" ||
    typeof latA !== "number" ||
    typeof lonB !== "number" ||
    typeof latB !== "number"
  ) {
    return null;
  }

  return { sourceLon: lonA, sourceLat: latA, targetLon: lonB, targetLat: latB };
}

// ---------------------------------------------------------------------------
// Layer builder
// ---------------------------------------------------------------------------

/**
 * Build deck.gl layers for a single cross-domain trip.
 *
 * Behaviour:
 * - If `selectedTripId` matches a group, that group is rendered.
 * - If `selectedTripId` is `null` (or unrecognised), the first group with
 *   any entries is used as a sensible default.
 * - When no trips exist the function returns an empty array — callers can
 *   omit the overlay entirely.
 *
 * Cruise legs are rendered via `createCruiseArcsLayer` (PathLayer, sky-blue).
 * Flight legs are rendered as amber ArcLayer arcs so both domains are
 * visually distinguishable at a glance.
 */
export function buildJourneyLayers(
  flights: readonly GeoJSONFeature[],
  cruises: readonly Cruise[],
  selectedTripId: string | null,
  /** The user's cruise colour mode + colours. Passed through so journey mode's
   *  cruise legs are tinted exactly like the dashboard legend says they are —
   *  omitting it falls back to the default status pair. */
  cruiseColorConfig?: CruiseColorConfig,
  /**
   * Metres to lift the trip's lines off the surface. 0 for the flat map;
   * `JOURNEY_GLOBE_ALTITUDE_M` for the globe, where an unlifted PathLayer
   * z-fights the sphere mesh and draws nothing — the defect
   * `TOUR_PATH_GLOBE_ALTITUDE_M` documents. The flight legs are an ArcLayer,
   * which bows above the surface on its own, so only the cruise legs need it.
   */
  altitudeM = 0
): Layer[] {
  const groups = groupByTripId(flights, cruises);

  const pickGroup = (): TripGroup | null => {
    if (selectedTripId !== null && groups[selectedTripId]) {
      return groups[selectedTripId];
    }
    const keys = Object.keys(groups);
    return keys.length > 0 ? groups[keys[0]] : null;
  };

  const trip = pickGroup();
  if (!trip) return [];

  const layers: Layer[] = [];

  // Cruise legs (PathLayer via shared helper) + directional arrow heads.
  if (trip.cruises.length > 0) {
    const cruiseOptions = { colorConfig: cruiseColorConfig, altitudeM };
    const cruiseLayer = createCruiseArcsLayer(
      trip.cruises,
      undefined,
      null,
      undefined,
      cruiseOptions
    );
    if (cruiseLayer !== null) layers.push(cruiseLayer);
    const arrowsLayer = createCruiseArrowsLayer(trip.cruises, undefined, null, cruiseOptions);
    if (arrowsLayer !== null) layers.push(arrowsLayer);
  }

  // Flight legs, amber to distinguish them from the cruise sky-blue.
  //
  // TWO layer types for one thing, because the two projections cannot draw
  // the same one. An `ArcLayer` computes its bow in its own vertex shader
  // from source and target in COMMON space, which MapLibre's globe projection
  // does not give it — which is why the globe's own flight arcs are a
  // `PathLayer` of pre-tessellated great-circle waypoints carrying a
  // z-altitude (`Globe/buildGlobeLayers.ts`), and never an ArcLayer.
  //
  // The Reise view drew NOTHING on the globe until this split (browser
  // verification, beta.12): the data was there, the layer was there, and the
  // globe simply could not render it. The flat map keeps the ArcLayer it has
  // always drawn.
  if (trip.flights.length > 0) {
    const rows = trip.flights.map(flightToArcRow).filter((r): r is FlightArcRow => r !== null);

    if (rows.length > 0) {
      layers.push(
        altitudeM > 0
          ? new PathLayer<JourneyFlightPath>({
              id: "journey-flight-arcs",
              data: rows.map(toGreatCirclePath),
              getPath: (d) => d.path,
              getColor: JOURNEY_FLIGHT_COLOR,
              getWidth: 2,
              widthUnits: "pixels",
              widthMinPixels: 1,
              capRounded: true,
              jointRounded: true,
            })
          : new ArcLayer<FlightArcRow>({
              id: "journey-flight-arcs",
              data: rows,
              getSourcePosition: (d) => [d.sourceLon, d.sourceLat],
              getTargetPosition: (d) => [d.targetLon, d.targetLat],
              getSourceColor: JOURNEY_FLIGHT_COLOR,
              getTargetColor: JOURNEY_FLIGHT_COLOR,
              getWidth: 2,
            })
      );
    }
  }

  return layers;
}
