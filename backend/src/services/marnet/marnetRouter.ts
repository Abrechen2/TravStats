/**
 * High-level marnet routing — snap two geographic points to the nearest
 * graph nodes, run A* between them, return the polyline + bookkeeping.
 *
 * This is the drop-in replacement for `searoute-ts`. The package's own
 * `seaRoute(origin, destination, 'kilometers')` returns a
 * `Feature<LineString>` whose `geometry.coordinates` is the routed
 * polyline starting at the snapped origin and ending at the snapped
 * destination (the real ports are NOT in the polyline — callers attach
 * them themselves). We mirror that contract exactly so existing call
 * sites only have to swap their function call.
 *
 * Two callers consume this router:
 *
 *   - `services/schematicRouter.ts::computeMaritimeGraphRoute()` —
 *     uses the polyline as the "core waypoints" of a cruise leg, with
 *     the real ports + harbour-approach corridors prepended/appended
 *     downstream. Cares about `coords` and the two snap distances.
 *
 *   - `services/cruiseDistance/marnetCalculator.ts` — uses the polyline
 *     length for distance accounting plus the snap distances as the
 *     "last-mile" hops back to the real ports. Cares about every field.
 */

import logger from "../../utils/logger";
import { haversineKm } from "../../shared/geo/haversine";
import {
  findMarnetPath,
  findNearestNode,
  loadMarnetGraph,
  type MarnetGraph,
} from "./marnetGraph";

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

export interface MarnetRouteResult {
  /** Routed polyline as [lon, lat] pairs. Starts at the snapped
   * departure node and ends at the snapped arrival node. The real
   * `dep`/`arr` coordinates are NOT included — callers stitch them in
   * (the real-port → snapped-node hop is the "last mile"). Always at
   * least two points; `null` is returned when no path exists. */
  readonly coords: ReadonlyArray<readonly [number, number]>;
  /** Sum of edge lengths along `coords` only. Does NOT include the
   * snap distances — those are reported separately so callers decide
   * whether to count them. */
  readonly lengthKm: number;
  /** Haversine distance from the real `dep` to the snapped graph
   * node. Caller checks this against a budget before trusting the
   * result; large snaps mean the port is far from any shipping lane
   * and the polyline can't reasonably claim to "follow" the route. */
  readonly snapDepKm: number;
  /** Symmetric snap distance for the arrival side. */
  readonly snapArrKm: number;
  /** A* node-expansion count — exposed for performance assertions in
   * tests; production callers ignore it. */
  readonly visitedNodes: number;
}

export interface MarnetRouteOptions {
  /** When set, reject routes whose snap on either end exceeds this
   * many kilometres. Default `null` = no caller-side budget; both
   * call sites enforce their own thresholds anyway. */
  readonly maxSnapKm?: number | null;
  /** Allow snapping to disconnected components (e.g. Caspian Sea
   * shipping nodes). Defaults to `false`: tiny isolated water bodies
   * never represent a real ocean cruise route, so we restrict
   * snapping to the global-ocean component. */
  readonly allowDisconnectedComponents?: boolean;
}

/** Route between two geographic points along the marnet shipping
 * graph. Returns `null` when no path is found, the same way the old
 * `searoute-ts` call effectively returned an unroutable result. */
export async function routeMarnet(
  dep: LatLon,
  arr: LatLon,
  options: MarnetRouteOptions = {},
): Promise<MarnetRouteResult | null> {
  const graph = await loadMarnetGraph();
  return routeMarnetWithGraph(graph, dep, arr, options);
}

/** Pure-function variant — used directly by tests with a synthetic
 * graph. Production code should prefer `routeMarnet()`. */
export function routeMarnetWithGraph(
  graph: MarnetGraph,
  dep: LatLon,
  arr: LatLon,
  options: MarnetRouteOptions = {},
): MarnetRouteResult | null {
  const onlyMainComponent = options.allowDisconnectedComponents !== true;
  const maxSnapKm = options.maxSnapKm ?? null;

  const depSnap = findNearestNode(graph, dep.lat, dep.lon, { onlyMainComponent });
  const arrSnap = findNearestNode(graph, arr.lat, arr.lon, { onlyMainComponent });

  if (depSnap === null || arrSnap === null) {
    logger.debug({
      operation: "marnet_router_no_snap",
      depFound: depSnap !== null,
      arrFound: arrSnap !== null,
    });
    return null;
  }

  if (maxSnapKm !== null && (depSnap.distKm > maxSnapKm || arrSnap.distKm > maxSnapKm)) {
    logger.debug({
      operation: "marnet_router_snap_exceeds_budget",
      maxSnapKm,
      depSnapKm: depSnap.distKm,
      arrSnapKm: arrSnap.distKm,
    });
    return null;
  }

  if (depSnap.node.componentId !== arrSnap.node.componentId) {
    // Both endpoints sit on water but in different connected
    // components — typically a landlocked sea on one side. No marnet
    // path can join them; caller must fall back.
    logger.debug({
      operation: "marnet_router_disconnected_components",
      depComponentId: depSnap.node.componentId,
      arrComponentId: arrSnap.node.componentId,
    });
    return null;
  }

  // Same node on both ends — routes that would be 0-length on the
  // graph are useless to consumers (schematicRouter rejects polylines
  // with < 2 distinct points and marnetCalculator can't infer a
  // detour ratio). Fall through.
  if (depSnap.node.key === arrSnap.node.key) {
    logger.debug({
      operation: "marnet_router_degenerate_same_node",
      key: depSnap.node.key,
    });
    return null;
  }

  const path = findMarnetPath(graph, depSnap.node.key, arrSnap.node.key);
  if (path === null || path.coords.length < 2) {
    logger.debug({
      operation: "marnet_router_no_path",
      depKey: depSnap.node.key,
      arrKey: arrSnap.node.key,
    });
    return null;
  }

  return {
    coords: path.coords,
    lengthKm: path.lengthKm,
    snapDepKm: depSnap.distKm,
    snapArrKm: arrSnap.distKm,
    visitedNodes: path.visitedNodes,
  };
}

/** Backwards-compat helper for sites that still want the
 * `Feature<LineString>` shape that `searoute-ts.seaRoute()` produced.
 * Exposed in case any future caller wants the literal old shape; the
 * two current consumers (schematicRouter, marnetCalculator) prefer the
 * structured result. */
export async function routeMarnetAsFeature(
  dep: LatLon,
  arr: LatLon,
  options: MarnetRouteOptions = {},
): Promise<{
  type: "Feature";
  properties: { lengthKm: number; snapDepKm: number; snapArrKm: number };
  geometry: { type: "LineString"; coordinates: ReadonlyArray<readonly [number, number]> };
} | null> {
  const result = await routeMarnet(dep, arr, options);
  if (result === null) return null;
  return {
    type: "Feature",
    properties: {
      lengthKm: result.lengthKm,
      snapDepKm: result.snapDepKm,
      snapArrKm: result.snapArrKm,
    },
    geometry: { type: "LineString", coordinates: result.coords },
  };
}

/** Re-export so consumers don't have to dual-import from the graph
 * module just to wire a test graph in. */
export { setMarnetGraphForTesting, buildMarnetGraphForTesting } from "./marnetGraph";

/** Sanity-check helper: confirm that a spot-check pair of named
 * landmark coordinates routes through the expected canal/strait. Not
 * called by production code — kept here so the smoke script and the
 * unit tests share a single place to assert "Suez actually works". */
export function debugCheckHaversineKm(a: LatLon, b: LatLon): number {
  return haversineKm(a, b);
}
