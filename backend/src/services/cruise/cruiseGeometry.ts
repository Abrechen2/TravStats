import type { Prisma } from "../../prisma";
import { buildEffectivePortSequence } from "../../shared/cruise/portSequence";
import { buildLegRouteOverrideMap, portLegRouteKey } from "../../shared/cruise/legRouteKey";
import { computeSchematicRoute } from "../schematicRouter";
import {
  CRUISE_TRACK_COVERAGE_SELECT,
  resolveRecordedLegs,
  type CruiseTrackCoverageRow,
} from "../cruiseDistance/recordedLegs";
import { isInlandLeg } from "../cruiseDistance/inlandLeg";
import { riverLegPath } from "../cruiseDistance/riverCalculator";

/**
 * The map line of every leg of one cruise — moved out of `routes/cruises.ts`
 * (2.7) when legs gained a third source of geometry, the recorded track, and
 * the route file would otherwise have grown past its size.
 *
 * Precedence per leg, the same order `cruiseLegService.ts` measures in:
 * recorded track (when its coverage verdict allows it) → hand-drawn line →
 * river line (an inland leg, `inlandLeg.ts`) or schematic sea route →
 * straight chord (the fallback of both).
 *
 * A leg from a port to itself (the ship lies in Luxor overnight, so Luxor
 * follows Luxor) has no computed line at all: it measures 0 km, and the sea
 * router answered it with an out-and-back spike to the nearest coast.
 */

/** Where a leg's line came from — the label the map and the cruise page show. */
export type CruiseGeometrySource = "track" | "drawn" | "river" | "sea_route" | "chord";

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
      | "recorded_track"
      | "river_line";
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
  /** "ocean" | "river" (`shared/cruiseKind.ts`); absent reads as ocean. */
  kind?: string | null;
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

    if (isSamePort(a, b)) continue;

    if (isInlandLeg(a, b, cruise.kind)) {
      features.push(await inlandFeature(a, b));
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

function isSamePort(a: PortRow, b: PortRow): boolean {
  return a.id === b.id || (a.lat === b.lat && a.lon === b.lon);
}

/**
 * An inland leg is never handed to the sea router: on its land/water mask a
 * Nile port is land, and the router drew every leg of a Nile cruise out to the
 * Red Sea and back (prod, 2026-10-16). The river line when both ports sit on
 * one known river — the polyline `riverCalculator` measures the kilometres on
 * — else the chord, which is what the distance chain then measures too.
 */
async function inlandFeature(a: PortRow, b: PortRow): Promise<GeometryFeature> {
  const path = await riverLegPath(toPortPoint(a), toPortPoint(b));
  const base = { fromPortId: a.id, toPortId: b.id, routed: false, protectedSuffixCount: 0 };
  if (path !== null) {
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: path },
      // Every vertex protected, as for a recording: a spline through sparse
      // river anchors would bow off the line the kilometres were counted on.
      properties: {
        ...base,
        protectedPrefixCount: path.length,
        method: "river_line",
        geometrySource: "river",
      },
    };
  }
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [a.lon, a.lat],
        [b.lon, b.lat],
      ],
    },
    properties: { ...base, protectedPrefixCount: 0, method: "direct", geometrySource: "chord" },
  };
}

function toPortPoint(p: PortRow): Parameters<typeof riverLegPath>[0] {
  return { id: p.id, lat: p.lat, lon: p.lon, unlocode: p.unlocode, region: p.region };
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
