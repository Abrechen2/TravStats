import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Cruise } from "../../types";
import type { CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { buildCruiseArc } from "./cruiseArc";
import {
  simplifyLineString,
  toleranceKmForZoom,
  type LonLat,
} from "../../shared/geo/simplifyLineString";

interface ArcDatum {
  path: [number, number][];
  cruiseId: string;
  cruiseLine: string | null;
  /** True when the geometry came from the A* sea-router; false when we
   * fell back to the Bezier placeholder. Kept in the datum so future
   * tooltips can surface it, and so tests can assert the right source. */
  computed: boolean;
}

/**
 * Per-cruise sea-route geometry coming from
 * `GET /api/v1/cruises/:id/geometry`. The map provides one of these
 * per cruise it wants on the map; missing entries (still fetching,
 * fetch failed) just fall through to the Bezier placeholder.
 */
export type CruiseGeometryMap = ReadonlyMap<string, CruiseRouteFeatureCollection>;

/**
 * Build a PathLayer of cruise legs — one path per consecutive stop
 * pair within each cruise. Prefers the real A* sea-route from the
 * backend when `geometryByCruise` has an entry for that cruise and
 * the current leg's port pair, and falls back to the Bezier arc
 * otherwise. At-sea days and stops without a resolved port are
 * skipped; cruises with fewer than two qualifying stops contribute
 * no arcs.
 *
 * Returns `null` when the data would produce an empty layer so
 * callers can omit it entirely rather than mounting a no-op.
 */
export function createCruiseArcsLayer(
  cruises: Cruise[],
  geometryByCruise: CruiseGeometryMap = new Map(),
  /**
   * Current deck.gl zoom level. Controls Douglas-Peucker simplification
   * of A*-computed legs: world-scale (≤3) compresses a 500-vertex route
   * to <20 without visible distortion. Bezier-fallback paths are
   * unaffected — they're already low-vertex by construction.
   */
  zoom = 3
): Layer | null {
  const tolerance = toleranceKmForZoom(zoom);
  const arcs: ArcDatum[] = [];
  for (const cruise of cruises) {
    const stops = cruise.stops
      .filter((s) => !s.isAtSea && s.port !== null)
      .sort((a, b) => a.dayNumber - b.dayNumber);

    const geometry = geometryByCruise.get(cruise.id);
    const computedByPair = buildComputedIndex(geometry);

    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i].port;
      const b = stops[i + 1].port;
      if (!a || !b) continue;
      const key = pairKey(a.id, b.id);
      const computed = computedByPair.get(key);
      if (computed) {
        arcs.push({
          path: tolerance > 0 ? simplifyLineString(computed as LonLat[], tolerance) : computed,
          cruiseId: cruise.id,
          cruiseLine: cruise.cruiseLine,
          computed: true,
        });
      } else {
        arcs.push({
          path: buildCruiseArc({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }),
          cruiseId: cruise.id,
          cruiseLine: cruise.cruiseLine,
          computed: false,
        });
      }
    }
  }
  if (arcs.length === 0) return null;

  return new PathLayer<ArcDatum>({
    id: "cruise-arcs",
    data: arcs,
    getPath: (d) => d.path,
    getColor: [56, 189, 248, 220],
    getWidth: 2,
    widthUnits: "pixels",
    pickable: true,
  });
}

function pairKey(fromPortId: number, toPortId: number): string {
  return `${fromPortId}→${toPortId}`;
}

/**
 * Flatten a cruise's FeatureCollection into a lookup keyed by
 * "fromPortId→toPortId" so the per-leg loop can look up in O(1).
 * Returns an empty map when there's no geometry yet — the caller
 * then renders Bezier for every leg in that cruise.
 */
function buildComputedIndex(
  geometry: CruiseRouteFeatureCollection | undefined
): Map<string, [number, number][]> {
  const index = new Map<string, [number, number][]>();
  if (!geometry) return index;
  for (const feature of geometry.features) {
    const { fromPortId, toPortId } = feature.properties;
    index.set(pairKey(fromPortId, toPortId), feature.geometry.coordinates);
  }
  return index;
}
