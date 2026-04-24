import { PathLayer, type PathLayerProps } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Cruise } from "../../types";
import type { CruiseRouteFeatureCollection, CruiseRouteQuality } from "../../lib/api/cruise";
import {
  simplifyLineString,
  toleranceKmForZoom,
  type LonLat,
} from "../../shared/geo/simplifyLineString";

interface ArcDatum {
  path: [number, number][];
  cruiseId: string;
  cruiseLine: string | null;
  /** "good" → real A* sea-route rendered solid. "schematic" → dashed
   * straight-line fallback used when the backend either returned no
   * geometry (landlocked port, disconnected seas) or a route whose
   * interior crosses ≥ 25 % land (river mouths, narrow straits that
   * A* couldn't thread). The two render paths are visually distinct
   * so users never mistake a schematic line for an actual trajectory. */
  quality: CruiseRouteQuality;
}

/**
 * Per-cruise sea-route geometry coming from
 * `GET /api/v1/cruises/:id/geometry`. The map provides one of these
 * per cruise it wants on the map; missing entries (still fetching,
 * fetch failed) just fall through to the schematic chord placeholder.
 */
export type CruiseGeometryMap = ReadonlyMap<string, CruiseRouteFeatureCollection>;

interface ComputedEntry {
  coords: [number, number][];
  quality: CruiseRouteQuality;
}

/**
 * Straight-line port-to-port fallback used when the backend has no
 * usable geometry for a leg. Two vertices, dashed rendering applied
 * downstream. Intentionally not a Bezier — a Bezier can still curve
 * over land and reads as an intentional trajectory, whereas a dashed
 * chord reads as a cartographic "schematic connection".
 */
function buildChordFallback(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): [number, number][] {
  return [
    [from.lon, from.lat],
    [to.lon, to.lat],
  ];
}

/**
 * Build a PathLayer of cruise legs — one path per consecutive stop
 * pair within each cruise. Prefers the real A* sea-route from the
 * backend when `geometryByCruise` has a good-quality entry for that
 * leg, and renders a dashed chord otherwise (missing geometry OR
 * schematic-quality geometry). At-sea days and stops without a
 * resolved port are skipped; cruises with fewer than two qualifying
 * stops contribute no arcs.
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
   * to <20 without visible distortion. Chord-fallback paths have only
   * two vertices so simplification is a no-op for them.
   */
  zoom = 3,
  /**
   * Currently selected cruise id. When non-null, non-selected arcs are
   * rendered at reduced alpha and selected arcs gain a thicker stroke —
   * the same highlight affordance the flight routes layer uses.
   */
  selectedCruiseId: string | null = null,
  /**
   * Click handler. The layer receives a cruise id; resolving it to a
   * Cruise object is the caller's job (they already have the list in
   * scope). Making this optional keeps render-only callers — the
   * editing detail page — from needing a stub.
   */
  onCruiseClick?: (cruiseId: string) => void
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
      const entry = computedByPair.get(pairKey(a.id, b.id));
      if (entry && entry.quality === "good") {
        arcs.push({
          path:
            tolerance > 0 ? simplifyLineString(entry.coords as LonLat[], tolerance) : entry.coords,
          cruiseId: cruise.id,
          cruiseLine: cruise.cruiseLine,
          quality: "good",
        });
      } else {
        arcs.push({
          path: buildChordFallback({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }),
          cruiseId: cruise.id,
          cruiseLine: cruise.cruiseLine,
          quality: "schematic",
        });
      }
    }
  }
  if (arcs.length === 0) return null;

  const hasSelection = selectedCruiseId !== null;
  const BASE_COLOR: [number, number, number] = [56, 189, 248];
  const HIGHLIGHT_COLOR: [number, number, number] = [253, 224, 71]; // accent yellow — matches flight highlight tone
  const DIM_ALPHA = 60;
  const SCHEMATIC_ALPHA = 120;
  const FULL_ALPHA = 220;

  const layerProps: PathLayerProps<ArcDatum> & PathStyleExtensionProps<ArcDatum> = {
    id: "cruise-arcs",
    data: arcs,
    getPath: (d) => d.path,
    getColor: (d) => {
      const baseColor = d.cruiseId === selectedCruiseId ? HIGHLIGHT_COLOR : BASE_COLOR;
      let alpha = FULL_ALPHA;
      if (hasSelection && d.cruiseId !== selectedCruiseId) alpha = DIM_ALPHA;
      else if (d.quality === "schematic") alpha = SCHEMATIC_ALPHA;
      return [...baseColor, alpha];
    },
    getWidth: (d) => (d.cruiseId === selectedCruiseId ? 4 : 2),
    widthUnits: "pixels",
    getDashArray: (d) => (d.quality === "schematic" ? [6, 3] : [0, 0]),
    dashJustified: true,
    extensions: [new PathStyleExtension({ dash: true })],
    pickable: true,
    onClick: onCruiseClick
      ? ({ object }: { object?: ArcDatum }) => {
          if (object?.cruiseId) onCruiseClick(object.cruiseId);
        }
      : undefined,
    updateTriggers: {
      getColor: selectedCruiseId,
      getWidth: selectedCruiseId,
    },
  };
  return new PathLayer<ArcDatum>(layerProps);
}

function pairKey(fromPortId: number, toPortId: number): string {
  return `${fromPortId}→${toPortId}`;
}

/**
 * Flatten a cruise's FeatureCollection into a lookup keyed by
 * "fromPortId→toPortId" so the per-leg loop can look up in O(1).
 * Returns an empty map when there's no geometry yet — the caller
 * then renders a chord for every leg in that cruise.
 */
function buildComputedIndex(
  geometry: CruiseRouteFeatureCollection | undefined
): Map<string, ComputedEntry> {
  const index = new Map<string, ComputedEntry>();
  if (!geometry) return index;
  for (const feature of geometry.features) {
    const { fromPortId, toPortId, quality } = feature.properties;
    index.set(pairKey(fromPortId, toPortId), {
      coords: feature.geometry.coordinates,
      quality,
    });
  }
  return index;
}

/**
 * Count how many legs of a cruise currently render as schematic given
 * the available geometry. Includes legs missing from the geometry
 * (backend skipped them) as well as legs whose geometry the backend
 * flagged as `schematic`. Used to surface the "n Abschnitte schematisch"
 * badge on cruise tooltips / detail pages.
 */
export function countSchematicLegs(
  cruise: Cruise,
  geometry: CruiseRouteFeatureCollection | undefined
): number {
  const stops = cruise.stops
    .filter((s) => !s.isAtSea && s.port !== null)
    .sort((a, b) => a.dayNumber - b.dayNumber);
  if (stops.length < 2) return 0;
  const index = buildComputedIndex(geometry);
  let schematic = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i].port;
    const b = stops[i + 1].port;
    if (!a || !b) continue;
    const entry = index.get(pairKey(a.id, b.id));
    if (!entry || entry.quality !== "good") schematic++;
  }
  return schematic;
}
