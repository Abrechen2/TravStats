import type { Prisma } from "../../prisma";
import { buildEffectivePortSequence } from "../../shared/cruise/portSequence";
import { buildLegRouteOverrideMap, portLegRouteKey } from "../../shared/cruise/legRouteKey";
import { computeSchematicRoute } from "../schematicRouter";
import {
  CRUISE_TRACK_COVERAGE_SELECT,
  resolveRecordedLegs,
  type CruiseTrackCoverageRow,
} from "../cruiseDistance/recordedLegs";

/**
 * The map line of every leg of one cruise — moved out of `routes/cruises.ts`
 * (2.7) when legs gained a third source of geometry, the recorded track, and
 * the route file would otherwise have grown past its size.
 *
 * Precedence per leg, the same order `cruiseLegService.ts` measures in:
 * recorded track (when its coverage verdict allows it) → hand-drawn line →
 * schematic sea route → straight chord (the router's own fallback).
 */

/** Where a leg's line came from — the label the map and the cruise page show. */
export type CruiseGeometrySource = "track" | "drawn" | "sea_route" | "chord";

export interface GeometryFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: {
    fromPortId: number;
    toPortId: number;
    routed: boolean;
    protectedPrefixCount: number;
    protectedSuffixCount: number;
    method:
      | "short_hop"
      | "maritime_graph"
      | "coarse_a_star"
      | "direct"
      | "manual_polyline"
      | "recorded_track";
    geometrySource: CruiseGeometrySource;
    /** The recording the line was cut from; only on `geometrySource: "track"`. */
    trackId?: string;
  };
}

export interface GeometryFeatureCollection {
  type: "FeatureCollection";
  features: GeometryFeature[];
}

type CruiseStopWithPort = Prisma.CruiseStopGetPayload<{ include: { port: true } }>;
type PortRow = Prisma.PortGetPayload<Record<string, never>>;

export interface CruiseGeometryInput {
  stops: CruiseStopWithPort[];
  departurePort: PortRow | null;
  arrivalPort: PortRow | null;
  legRoutes?: Array<{
    fromKind: string;
    fromRef: string;
    toKind: string;
    toRef: string;
    waypoints: unknown;
  }>;
  tracks?: CruiseTrackCoverageRow[];
}

/** The include both geometry routes load a cruise with. */
export const CRUISE_GEOMETRY_INCLUDE = {
  stops: { include: { port: true }, orderBy: { dayNumber: "asc" as const } },
  departurePort: true,
  arrivalPort: true,
  legRoutes: true,
  tracks: { select: CRUISE_TRACK_COVERAGE_SELECT },
} as const;

/**
 * Compute the GeoJSON FeatureCollection for one cruise's itinerary.
 * The route covers departure port → port-call stops → arrival port;
 * each consecutive port-pair becomes one LineString. Sea-day and
 * unmatched stops are skipped — they don't contribute legs. The
 * underlying `computeSchematicRoute` is cached, so calling this in a
 * batch over the same set of port-pairs is essentially free after the
 * first miss.
 */
export async function buildCruiseGeometry(
  cruise: CruiseGeometryInput
): Promise<{ collection: GeometryFeatureCollection; routedLegs: number; directLegs: number }> {
  const portCalls = cruise.stops
    .filter((s) => !s.isAtSea && s.port !== null)
    .map((s) => s.port as PortRow);
  const ordered = buildEffectivePortSequence(cruise.departurePort, portCalls, cruise.arrivalPort);
  const features: GeometryFeature[] = [];
  let routedLegs = 0;
  let directLegs = 0;

  // The stored line wins. It has to be the same source the distance came from
  // (services/cruiseDistance/cruiseLegService.ts), or the map and the
  // statistics would quietly disagree.
  const overrideByLeg = buildLegRouteOverrideMap(cruise.legRoutes ?? []);
  const { recorded } = resolveRecordedLegs(ordered, cruise.tracks ?? []);

  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];

    const measured = recorded[i];
    if (measured !== null) {
      const coordinates = measured.slice.waypoints;
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {
          fromPortId: a.id,
          toPortId: b.id,
          routed: false,
          // Every vertex protected: the client splines a router's sparse
          // control points into a curve, and doing that to a recording would
          // smooth away what was measured and multiply a dense line twelvefold
          // (`buildRenderableRoutePath` in cruiseArcsLayer.ts draws a fully
          // protected line exactly as given).
          protectedPrefixCount: coordinates.length,
          protectedSuffixCount: 0,
          method: "recorded_track",
          geometrySource: "track",
          trackId: measured.trackId,
        },
      });
      directLegs++;
      continue;
    }

    const manual = overrideByLeg.get(portLegRouteKey(a.id, b.id));
    if (manual && manual.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: manual },
        properties: {
          fromPortId: a.id,
          toPortId: b.id,
          routed: false,
          protectedPrefixCount: 0,
          protectedSuffixCount: 0,
          method: "manual_polyline",
          geometrySource: "drawn",
        },
      });
      directLegs++;
      continue;
    }

    const route = await computeSchematicRoute(toSchematicPort(a), toSchematicPort(b));
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: route.waypoints },
      properties: {
        fromPortId: a.id,
        toPortId: b.id,
        routed: route.routed,
        protectedPrefixCount: route.protectedPrefixCount,
        protectedSuffixCount: route.protectedSuffixCount,
        method: route.method,
        geometrySource: route.routed ? "sea_route" : "chord",
      },
    });
    if (route.routed) routedLegs++;
    else directLegs++;
  }

  return { collection: { type: "FeatureCollection", features }, routedLegs, directLegs };
}

function toSchematicPort(p: PortRow): Parameters<typeof computeSchematicRoute>[0] {
  return {
    id: p.id,
    name: p.name,
    city: p.city,
    country: p.country,
    unlocode: p.unlocode,
    lat: p.lat,
    lon: p.lon,
  };
}
