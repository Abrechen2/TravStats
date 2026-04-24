import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Cruise } from "../../types";
import type { CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { catmullRomSpline } from "./catmullRom";

interface ArcDatum {
  path: [number, number][];
  cruiseId: string;
  cruiseLine: string | null;
}

/**
 * Per-cruise sea-route waypoints from `GET /api/v1/cruises/:id/geometry`.
 * Map provides one FeatureCollection per visible cruise; missing
 * entries (still fetching, fetch failed) fall through to the
 * waypoint-less chord fallback in `createCruiseArcsLayer`.
 */
export type CruiseGeometryMap = ReadonlyMap<string, CruiseRouteFeatureCollection>;

/**
 * Build a PathLayer of cruise legs rendered as smooth Catmull-Rom
 * splines through the backend's coarse waypoints. One path per
 * consecutive stop pair within each cruise. At-sea days and stops
 * without a resolved port are skipped.
 *
 * When the backend hasn't returned geometry for a cruise yet, legs
 * fall back to a 2-vertex direct chord which the spline renders as
 * a straight line — nothing in the map ever looks disconnected.
 *
 * Returns `null` when no leg can be drawn so callers can omit the
 * layer entirely rather than mounting a no-op.
 */
export function createCruiseArcsLayer(
  cruises: Cruise[],
  geometryByCruise: CruiseGeometryMap = new Map(),
  /**
   * Currently selected cruise id. Non-selected arcs render at reduced
   * alpha; selected arcs gain a thicker, fully-opaque stroke.
   */
  selectedCruiseId: string | null = null,
  /** Click handler — receives the cruise id. */
  onCruiseClick?: (cruiseId: string) => void
): Layer | null {
  const arcs: ArcDatum[] = [];
  for (const cruise of cruises) {
    const stops = cruise.stops
      .filter((s) => !s.isAtSea && s.port !== null)
      .sort((a, b) => a.dayNumber - b.dayNumber);

    const geometry = geometryByCruise.get(cruise.id);
    const waypointsByPair = buildWaypointIndex(geometry);

    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i].port;
      const b = stops[i + 1].port;
      if (!a || !b) continue;
      const waypoints = waypointsByPair.get(pairKey(a.id, b.id)) ?? [
        [a.lon, a.lat],
        [b.lon, b.lat],
      ];
      arcs.push({
        path: catmullRomSpline(waypoints),
        cruiseId: cruise.id,
        cruiseLine: cruise.cruiseLine,
      });
    }
  }
  if (arcs.length === 0) return null;

  const hasSelection = selectedCruiseId !== null;
  const BASE_COLOR: [number, number, number] = [56, 189, 248];
  const HIGHLIGHT_COLOR: [number, number, number] = [253, 224, 71];
  const DIM_ALPHA = 90;
  const FULL_ALPHA = 220;

  return new PathLayer<ArcDatum>({
    id: "cruise-arcs",
    data: arcs,
    getPath: (d) => d.path,
    getColor: (d) => {
      if (!hasSelection) return [...BASE_COLOR, FULL_ALPHA];
      if (d.cruiseId === selectedCruiseId) return [...HIGHLIGHT_COLOR, FULL_ALPHA];
      return [...BASE_COLOR, DIM_ALPHA];
    },
    getWidth: (d) => (d.cruiseId === selectedCruiseId ? 3 : 2),
    widthUnits: "pixels",
    capRounded: true,
    jointRounded: true,
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
  });
}

function pairKey(fromPortId: number, toPortId: number): string {
  return `${fromPortId}→${toPortId}`;
}

function buildWaypointIndex(
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
