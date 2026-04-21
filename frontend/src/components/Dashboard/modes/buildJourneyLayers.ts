import { ArcLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { createCruiseArcsLayer } from "../../layers/cruiseArcsLayer";
import type { GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TripGroup {
  flights: GeoJSONFeature[];
  cruises: Cruise[];
}

// ---------------------------------------------------------------------------
// Grouping helper
// ---------------------------------------------------------------------------

/**
 * Extract `tripId` from a GeoJSON feature's properties.
 *
 * The backend does not yet expose `tripId` on the GeoJSON endpoint, so the
 * `GeoJSONFeature` type does not declare it.  We cast via `unknown` so the
 * helper is forward-compatible once the backend starts including it.
 * Missing or empty-string values are treated the same as `null`.
 */
function featureTripId(f: GeoJSONFeature): string | null {
  const props = (f.properties ?? {}) as Record<string, unknown>;
  const tid = props["tripId"];
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
  selectedTripId: string | null
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

  // Cruise legs (PathLayer via shared helper)
  if (trip.cruises.length > 0) {
    const cruiseLayer = createCruiseArcsLayer(trip.cruises);
    if (cruiseLayer !== null) layers.push(cruiseLayer);
  }

  // Flight legs (ArcLayer, amber to distinguish from cruise sky-blue)
  if (trip.flights.length > 0) {
    const rows = trip.flights.map(flightToArcRow).filter((r): r is FlightArcRow => r !== null);

    if (rows.length > 0) {
      layers.push(
        new ArcLayer<FlightArcRow>({
          id: "journey-flight-arcs",
          data: rows,
          getSourcePosition: (d) => [d.sourceLon, d.sourceLat],
          getTargetPosition: (d) => [d.targetLon, d.targetLat],
          getSourceColor: [245, 158, 11, 220],
          getTargetColor: [245, 158, 11, 220],
          getWidth: 2,
        })
      );
    }
  }

  return layers;
}
