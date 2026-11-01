import { createSchematicRouteStore, schematicRouteVersion } from "./routing/schematicRouteStore";
import { routeKey } from "./routing/routeStore";
import { LruMap } from "../utils/lruMap";
/**
 * Schematic cruise-route pipeline — coarse waypoints + spline approach.
 *
 * Completely replaces the Hybrid-v2 A* pipeline (`seaRouter.ts`). The
 * old approach tried to produce a nautically-accurate polyline on a
 * 0.1°/0.05° grid, fought with mask resolution at every narrow strait,
 * and still looked bad because 0.1° zig-zags are ugly. This one treats
 * cruise routes as symbolic links between ports, like the illustrated
 * travel maps cruise operators show their customers.
 *
 * Contract:
 *   - Input: `dep`, `arr` = lat/lon of two ports
 *   - Output: an array of `[lon, lat]` waypoints (3-8 points typical);
 *     first is always `dep`, last is always `arr`
 *   - The frontend runs a Catmull-Rom spline through the waypoints
 *     and renders a smooth curve. Missing intermediate waypoints are
 *     not a bug — they're how the aesthetic works
 *
 * Algorithm:
 *   1. A 1° A* finds a coarse water path. 1° cells are 111 km at the
 *      equator, so fjords and narrow straits collapse — that's fine,
 *      the spline smooths everything
 *   2. Douglas-Peucker simplification compresses the A* grid path to
 *      3-8 cell-centre waypoints along the route
 *   3. The raw port coords are always the first/last waypoint so the
 *      rendered arc starts/ends exactly at the port marker
 *   4. If A* fails (truly disconnected, e.g. Caspian Sea ↔ ocean),
 *      return `[dep, arr]` — a straight chord — rather than null. The
 *      spline still produces a reasonable curve, the user sees a
 *      direct connection instead of nothing
 */

import { promises as fs } from "fs";
import path from "path";

import logger from "../utils/logger";
import { getPortApproach, type SchematicRoutePort } from "./schematicPortApproaches";
import {
  arcLengthResample,
  dropUTurnNodes,
  insertCoastBuffers,
  segmentAllWater,
  segmentMaxLandRun,
  simplifyDegrees,
} from "./schematicPolyline";

export type { SchematicRoutePort };
export { arcLengthResample, simplifyDegrees };
import { haversineKm } from "../shared/geo/haversine";
import { BinaryHeap } from "../shared/geo/binaryHeap";
import { MASK_COLS, MASK_ROWS, cellIndex, getBit } from "../shared/geo/landMaskGrid";
import { logMarnetFailureOnce, routeMarnet } from "./marnet/marnetRouter";

import {
  MASK1_BYTES,
  MASK1_COLS,
  MASK1_ROWS,
  MASK1_TOTAL_CELLS,
  cellCenter1,
  cellIndex1,
  colFromIndex1,
  getBit1,
  latToRow1,
  lonToCol1,
  rowFromIndex1,
  setBit1,
} from "../shared/geo/landMaskGridCoarse";

const DEFAULT_FINE_MASK_PATH = path.resolve(__dirname, "..", "..", "data", "land-mask.bin");

/** A 1° cell is water if at least this fraction of its 100 sub-cells
 * on the 0.1° mask is water. 0.4 is a compromise — too low (0.3) lets
 * the Dutch coast pass as water and routes cut through NL via lakes;
 * too high (0.5) forces A* to skip intermediate coastal cells and
 * the spline ends up clipping land on long offshore jumps. */
const COARSE_WATER_THRESHOLD = 0.4;

/** Maximum A* cells visited before giving up. 1° grid is 64 800 cells
 * total; even worst-case transoceanic routes visit <10k cells with a
 * haversine heuristic. */
const COARSE_A_STAR_BUDGET = 50_000;

/** Douglas-Peucker simplification tolerance, in degrees. 0.3° ≈ 33 km
 * at the equator. The spline needs to see the coastal-detour
 * waypoints that keep the rendered curve offshore — 0.8° was dropping
 * them on medium-length coastal legs (Rotterdam → Bremerhaven), so
 * the chord between the surviving points ended up crossing the
 * Netherlands. Lower values here = more waypoints per leg = more
 * faithful-looking curve, at the cost of payload size (still tiny). */
const SIMPLIFY_TOLERANCE_DEG = 0.3;

/** Below this great-circle distance (km), bypass A* and emit a direct
 * port→port chord. Reason: 1° A* + Catmull-Rom spline produces a
 * visibly bow-shaped curve for short coastal hops (e.g.
 * Rotterdam→Middelburg, ~80 km) because the spline's "natural" curvature
 * dominates over the few cell-centre waypoints between them. The
 * coast-buffer post-pass still runs on the chord, so if the direct
 * line clips a peninsula it still picks up one offshore waypoint. */
const SHORT_HOP_KM = 150;

/** Arc-length step for the middle-of-route resample applied AFTER
 * routing. The marnet graph has highly irregular node spacing — clusters
 * of duplicate near-coincident nodes inside straits (Kiel/Fehmarn,
 * Florida Strait, Bosphorus) turn into 150-180° u-turns when the spline
 * tries to interpolate them. Resampling the non-corridor middle at a
 * uniform ~60 km arc length collapses each cluster into a single
 * interpolated vertex on the route's general direction, after which the
 * downstream centripetal Catmull-Rom on the frontend produces a smooth
 * curve. The resample preserves exact endpoints so corridor handoffs
 * remain stable. The 60 km value was chosen empirically in the
 * `tools/route-audit/harness/` test suite — 30 km kept too much node
 * detail (mean worst kink 19°), 100 km over-smoothed coastal corners
 * (max land fraction crept up). 60 km hits 0 / 94 demo legs with a
 * kink ≥ 90° on the rendered curve. */
const RESAMPLE_STEP_KM = 60;

/** When the BFS-snapped water cell sits more than this many km from the
 * actual port (typical for fjord ports like Flåm, where the 1° cell
 * containing the port is dominated by mountains and the snap lands far
 * out at sea), insert a single intermediate "approach" waypoint at the
 * midpoint between port and snapped cell. Smooths the elbow that would
 * otherwise form right next to the port marker. */
const FJORD_SNAP_THRESHOLD_KM = 80;

let maskBytes: Uint8Array | null = null;
let fineMaskBytes: Uint8Array | null = null;
let loadPromise: Promise<Uint8Array> | null = null;

// Maritime-graph routing is provided by `services/marnet/marnetRouter`,
// which loads the vendored Eurostat marnet GeoJSON (formerly accessed
// via `searoute-ts` whose ESM packaging silently broke on Node ≥ 22).
// Tests inject a synthetic graph through `setMarnetGraphForTesting`
// where needed.

function sameWaypoint(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function appendUnique(out: [number, number][], point: [number, number]): void {
  if (out.length === 0 || !sameWaypoint(out[out.length - 1], point)) out.push(point);
}

interface ComposedRoute {
  readonly waypoints: [number, number][];
  readonly protectedPrefixCount: number;
  readonly protectedSuffixCount: number;
}

function composeRouteWaypoints(
  dep: SchematicRoutePort,
  depApproach: ReadonlyArray<[number, number]>,
  coreWaypoints: ReadonlyArray<[number, number]>,
  arrApproach: ReadonlyArray<[number, number]>,
  arr: SchematicRoutePort
): ComposedRoute {
  const out: [number, number][] = [];
  appendUnique(out, [dep.lon, dep.lat]);
  for (const point of depApproach) appendUnique(out, point);
  for (const point of coreWaypoints) appendUnique(out, point);
  for (const point of [...arrApproach].reverse()) appendUnique(out, point);
  appendUnique(out, [arr.lon, arr.lat]);
  return {
    waypoints: out,
    protectedPrefixCount: depApproach.length > 0 ? depApproach.length + 1 : 0,
    protectedSuffixCount: arrApproach.length > 0 ? arrApproach.length + 1 : 0,
  };
}

/** Downsample the fine raster to 1°. A 1° cell is water when
 * COARSE_WATER_THRESHOLD of its sub-cells are water. The factor is
 * derived from the constants so bumps to mask resolution propagate
 * automatically — bumping the fine grid from 0.1° to 0.025° goes from
 * 100 to 1600 sub-cells per coarse cell. */
const FINE_PER_COARSE_AXIS = MASK_COLS / MASK1_COLS;
const FINE_PER_COARSE_TOTAL = FINE_PER_COARSE_AXIS * FINE_PER_COARSE_AXIS;

function downsampleMask(finBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(MASK1_BYTES);
  for (let row = 0; row < MASK1_ROWS; row++) {
    const fineRowStart = row * FINE_PER_COARSE_AXIS;
    for (let col = 0; col < MASK1_COLS; col++) {
      const fineColStart = col * FINE_PER_COARSE_AXIS;
      let water = 0;
      for (let dr = 0; dr < FINE_PER_COARSE_AXIS; dr++) {
        const fr = fineRowStart + dr;
        if (fr >= MASK_ROWS) continue;
        for (let dc = 0; dc < FINE_PER_COARSE_AXIS; dc++) {
          const fc = (fineColStart + dc) % MASK_COLS;
          if (getBit(finBytes, cellIndex(fr, fc)) === 0) water++;
        }
      }
      const isWater = water / FINE_PER_COARSE_TOTAL >= COARSE_WATER_THRESHOLD;
      setBit1(out, cellIndex1(row, col), isWater ? 0 : 1);
    }
  }
  return out;
}

export async function loadCoarseMask(): Promise<Uint8Array> {
  if (maskBytes !== null) return maskBytes;
  if (loadPromise === null) {
    loadPromise = (async (): Promise<Uint8Array> => {
      const buf = await fs.readFile(DEFAULT_FINE_MASK_PATH);
      const fine = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      fineMaskBytes = fine;
      const coarse = downsampleMask(fine);
      maskBytes = coarse;
      let waterCells = 0;
      for (let i = 0; i < MASK1_TOTAL_CELLS; i++) if (getBit1(coarse, i) === 0) waterCells++;
      logger.info({
        operation: "schematic_router_mask_built",
        bytes: coarse.byteLength,
        waterCells,
        waterPct: Math.round((waterCells / MASK1_TOTAL_CELLS) * 100),
      });
      return coarse;
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

export function setCoarseMaskForTesting(bytes: Uint8Array | null, fine?: Uint8Array | null): void {
  maskBytes = bytes;
  fineMaskBytes = fine ?? null;
  loadPromise = bytes === null ? null : Promise.resolve(bytes);
}

function cellIsWater1(bytes: Uint8Array, row: number, col: number): boolean {
  if (row < 0 || row >= MASK1_ROWS) return false;
  const c = ((col % MASK1_COLS) + MASK1_COLS) % MASK1_COLS;
  return getBit1(bytes, cellIndex1(row, c)) === 0;
}

const NEIGHBOUR_STEPS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

function findNearestWaterCell(
  bytes: Uint8Array,
  lat: number,
  lon: number,
  maxCells = 500
): { row: number; col: number } | null {
  const startRow = latToRow1(lat);
  const startCol = lonToCol1(lon);
  if (cellIsWater1(bytes, startRow, startCol)) return { row: startRow, col: startCol };

  const visited = new Uint8Array(MASK1_TOTAL_CELLS);
  const queue: number[] = [cellIndex1(startRow, startCol)];
  visited[queue[0]] = 1;

  let explored = 0;
  let head = 0;
  while (head < queue.length && explored < maxCells) {
    const idx = queue[head++];
    const row = rowFromIndex1(idx);
    const col = colFromIndex1(idx);
    explored++;

    for (const [dr, dc] of NEIGHBOUR_STEPS) {
      const nr = row + dr;
      if (nr < 0 || nr >= MASK1_ROWS) continue;
      const nc = (((col + dc) % MASK1_COLS) + MASK1_COLS) % MASK1_COLS;
      const nIdx = cellIndex1(nr, nc);
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      if (cellIsWater1(bytes, nr, nc)) return { row: nr, col: nc };
      queue.push(nIdx);
    }
  }
  return null;
}

interface AStarNode {
  index: number;
  f: number;
}

function cellDistanceKm(aIdx: number, bIdx: number): number {
  const a = cellCenter1(rowFromIndex1(aIdx), colFromIndex1(aIdx));
  const b = cellCenter1(rowFromIndex1(bIdx), colFromIndex1(bIdx));
  return haversineKm(a, b);
}

function coarseAStar(bytes: Uint8Array, startIdx: number, goalIdx: number): number[] | null {
  if (startIdx === goalIdx) return [startIdx];

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  gScore.set(startIdx, 0);
  const open = new BinaryHeap<AStarNode>((n) => n.f);
  open.push({ index: startIdx, f: cellDistanceKm(startIdx, goalIdx) });

  let visited = 0;
  while (open.size > 0 && visited < COARSE_A_STAR_BUDGET) {
    const current = open.pop() as AStarNode;
    if (closed.has(current.index)) continue;
    closed.add(current.index);
    visited++;

    if (current.index === goalIdx) {
      const path: number[] = [];
      let cursor: number | undefined = goalIdx;
      while (cursor !== undefined) {
        path.unshift(cursor);
        cursor = cameFrom.get(cursor);
      }
      return path;
    }

    const row = rowFromIndex1(current.index);
    const col = colFromIndex1(current.index);
    const curG = gScore.get(current.index) ?? Infinity;

    for (const [dr, dc] of NEIGHBOUR_STEPS) {
      const nr = row + dr;
      if (nr < 0 || nr >= MASK1_ROWS) continue;
      const nc = (((col + dc) % MASK1_COLS) + MASK1_COLS) % MASK1_COLS;
      if (!cellIsWater1(bytes, nr, nc)) continue;
      const nIdx = cellIndex1(nr, nc);
      if (closed.has(nIdx)) continue;
      const stepKm = cellDistanceKm(current.index, nIdx);
      const tentative = curG + stepKm;
      const prev = gScore.get(nIdx);
      if (prev !== undefined && tentative >= prev) continue;
      gScore.set(nIdx, tentative);
      cameFrom.set(nIdx, current.index);
      open.push({ index: nIdx, f: tentative + cellDistanceKm(nIdx, goalIdx) });
    }
  }
  return null;
}

/**
 * Apply `arcLengthResample` to the non-corridor middle of a composed
 * route. The corridor prefix/suffix (driven by `protectedPrefixCount`
 * / `protectedSuffixCount`) is left untouched — those waypoints encode
 * the hand-tuned harbour-approach paths that must be drawn exactly.
 *
 * The middle includes the boundary protected vertices on both sides so
 * the resampled polyline starts at the corridor's exit point and ends
 * at the arrival corridor's entry point, keeping the join continuous.
 *
 * Returns the new full waypoint list plus updated protected counts.
 */
function resampleNonCorridorMiddle(composed: ComposedRoute): ComposedRoute {
  const wp = composed.waypoints;
  const prefix = composed.protectedPrefixCount;
  const suffix = composed.protectedSuffixCount;
  // Slice the spline input the same way the frontend does — including the
  // last protected prefix vertex and the first protected suffix vertex so
  // the resampled curve covers the whole join smoothly.
  const middleStart = prefix > 0 ? prefix - 1 : 0;
  const middleEnd = suffix > 0 ? wp.length - suffix + 1 : wp.length;
  if (middleEnd - middleStart < 3) return composed;
  const middle = wp.slice(middleStart, middleEnd);
  const resampled = arcLengthResample(middle, RESAMPLE_STEP_KM);
  if (resampled.length === middle.length) return composed;
  const newWaypoints: [number, number][] = [];
  for (let i = 0; i < middleStart; i++) newWaypoints.push(wp[i]);
  for (const point of resampled) newWaypoints.push(point);
  for (let i = middleEnd; i < wp.length; i++) newWaypoints.push(wp[i]);
  return {
    waypoints: newWaypoints,
    protectedPrefixCount: prefix,
    protectedSuffixCount: suffix,
  };
}

async function computeMaritimeGraphRoute(
  dep: { lat: number; lon: number },
  arr: { lat: number; lon: number },
  fineBytes: Uint8Array | null
): Promise<[number, number][] | null> {
  try {
    const chordKm = haversineKm(dep, arr);
    // Marnet's nearest shipping-lane node is often 30-80 km from a port
    // (Kiel, Lübeck, Stockholm, Oslo, fjord ports). The budget
    // (100 km floor / 500 km cap / 35 % of chord) is permissive enough
    // to keep marnet results for every realistic landlocked-port
    // pairing while still vetoing nonsense snaps.
    const snapBudgetKm = Math.min(500, Math.max(100, chordKm * 0.35));
    const route = await routeMarnet(dep, arr, {
      maxSnapKm: snapBudgetKm,
      preferForwardSnap: true,
    });
    if (route === null) return null;
    const rawCoords = route.coords.map(([lon, lat]) => [lon, lat] as [number, number]);
    const coords = dropUTurnNodes(rawCoords);
    if (coords.length < 2) return null;

    if (fineBytes === null) return coords;

    const repaired = insertCoastBuffers(coords, fineBytes);
    for (let i = 1; i < repaired.length; i++) {
      const [lon0, lat0] = repaired[i - 1];
      const [lon1, lat1] = repaired[i];
      // Maritime graph nodes are intentionally close to real coastlines.
      // Reject only sustained land cuts; isolated raster hits near a
      // harbour or island edge would otherwise discard good graph routes.
      // Threshold relaxed from 5 to 10 cells (~110 km of contiguous land
      // on the 0.1° mask) — Baltic legs through narrow island passages
      // (Kiel-Bight, Greifswalder-Bodden, Stockholm archipelago) clip
      // small island corners on the marnet polyline; the 5-cell cap
      // discarded those routes in favour of the 1° A* fallback whose
      // own land-cut artefacts are worse.
      // Threshold ≈ 110 km of contiguous land at the new 0.05° sample
      // step (was 10 × 0.15° on the legacy 0.1° mask, same physical
      // distance). Baltic legs through narrow Stockholm-archipelago
      // passages clip small island corners on the marnet polyline; a
      // tighter cap discards otherwise-valid graph routes in favour of
      // the 1° A* fallback whose own land-cut artefacts are worse.
      if (segmentMaxLandRun(fineBytes, lon0, lat0, lon1, lat1) >= 20) return null;
    }
    return repaired;
  } catch (error) {
    return logMarnetFailureOnce(error);
  }
}

export interface SchematicRoute {
  /** [lon, lat] waypoints. First is always `dep`, last is always
   * `arr`. Intermediates are continental-scale detours around
   * landmasses (usually 0-5 of them). Frontend splines through
   * these to get the final curve. */
  readonly waypoints: [number, number][];
  /** Number of leading waypoints that must be rendered as an exact
   * polyline. Used for river/harbour exits such as Hamburg -> German
   * Bight, where a spline would otherwise cut across land. */
  readonly protectedPrefixCount: number;
  /** Number of trailing waypoints that must be rendered as an exact
   * polyline for fixed harbour approaches into the arrival port. */
  readonly protectedSuffixCount: number;
  /** True when A* found a coarse water path; false when ports were on
   * disconnected components and we fell back to a direct chord. The
   * frontend renders both identically — the flag is informational,
   * letting callers surface a "direct line" badge if desired. */
  readonly routed: boolean;
  readonly method: "short_hop" | "maritime_graph" | "coarse_a_star" | "direct";
}

/** Hot set backed by durable successful routes. The key carries the policy
 * and a hash of the maritime graph and masks (schematicRouteVersion). */
let durableRoutes = createSchematicRouteStore();

function routeCacheKey(dep: SchematicRoutePort, arr: SchematicRoutePort): string | null {
  if (dep.id === undefined || arr.id === undefined) return null;
  return routeKey([schematicRouteVersion(), dep, arr, getPortApproach(dep), getPortApproach(arr)]);
}

const fallbackRoutes = new LruMap<string, SchematicRoute>(500);

export function clearSchematicRouteCache(): void {
  fallbackRoutes.clear();
  durableRoutes = createSchematicRouteStore();
}

/**
 * Compute a schematic waypoint list between two ports. Always
 * returns — even in pathological cases (landlocked ports, mask
 * inconsistencies) you get `{waypoints: [dep, arr], routed: false}`,
 * which the frontend can still render as a straight link.
 *
 * Cache identity includes coordinates and harbour approaches, not only IDs.
 */
export async function computeSchematicRoute(
  dep: SchematicRoutePort,
  arr: SchematicRoutePort
): Promise<SchematicRoute> {
  const key = routeCacheKey(dep, arr);

  const compute = async (): Promise<SchematicRoute> => {
    const raw = await computeSchematicRouteUncached(dep, arr);
    const smoothed = resampleNonCorridorMiddle(raw);
    return { ...raw, ...smoothed };
  };
  if (key === null) return compute();
  // RouteStore keeps only routed results; a straight-chord fallback would be
  // recomputed (full A*) on every request, so those get a small bounded memo.
  const fallback = fallbackRoutes.get(key);
  if (fallback) return structuredClone(fallback);
  const result = await durableRoutes.resolve(key, compute, (route) => route.routed);
  if (!result.routed) fallbackRoutes.set(key, structuredClone(result));
  return result;
}

async function computeSchematicRouteUncached(
  dep: SchematicRoutePort,
  arr: SchematicRoutePort
): Promise<SchematicRoute> {
  const t0 = Date.now();
  const bytes = await loadCoarseMask();
  const depApproach = getPortApproach(dep);
  const arrApproach = getPortApproach(arr);
  const depRoutePoint = depApproach[depApproach.length - 1] ?? [dep.lon, dep.lat];
  const arrRoutePoint = arrApproach[arrApproach.length - 1] ?? [arr.lon, arr.lat];
  const routeDep = { lat: depRoutePoint[1], lon: depRoutePoint[0] };
  const routeArr = { lat: arrRoutePoint[1], lon: arrRoutePoint[0] };

  // Short-hop bypass: skip the 1° A* entirely WHEN the direct chord
  // doesn't clip land. The grid is too coarse to add useful
  // intermediate waypoints over <150 km open-water hops, and the
  // spline produced from [port, port] alone curves nicely.
  //
  // CRITICAL: only bypass when the chord is all-water on the fine
  // mask. Without this guard, fjord-to-fjord hops (Bergen → Flåm,
  // Flåm → Geiranger) — both <150 km, both crossing Norwegian
  // mountains — would short-circuit to a straight line that visibly
  // cuts across land. When the chord clips land, fall through to A*.
  const chordKm = haversineKm(routeDep, routeArr);
  if (
    chordKm < SHORT_HOP_KM &&
    fineMaskBytes !== null &&
    segmentAllWater(fineMaskBytes, routeDep.lon, routeDep.lat, routeArr.lon, routeArr.lat)
  ) {
    const composed = composeRouteWaypoints(
      dep,
      depApproach,
      [
        [routeDep.lon, routeDep.lat],
        [routeArr.lon, routeArr.lat],
      ],
      arrApproach,
      arr
    );
    logger.debug({
      operation: "schematic_router_short_hop",
      chordKm: Math.round(chordKm),
      outputWaypoints: composed.waypoints.length,
      durationMs: Date.now() - t0,
    });
    return { ...composed, routed: true, method: "short_hop" };
  }

  if (fineMaskBytes !== null) {
    const maritimeGraphRoute = await computeMaritimeGraphRoute(routeDep, routeArr, fineMaskBytes);
    if (maritimeGraphRoute !== null) {
      const composed = composeRouteWaypoints(
        dep,
        depApproach,
        maritimeGraphRoute,
        arrApproach,
        arr
      );
      logger.debug({
        operation: "schematic_router_maritime_graph",
        chordKm: Math.round(chordKm),
        graphWaypoints: maritimeGraphRoute.length,
        outputWaypoints: composed.waypoints.length,
        departureApproachWaypoints: depApproach.length,
        arrivalApproachWaypoints: arrApproach.length,
        durationMs: Date.now() - t0,
      });
      return { ...composed, routed: true, method: "maritime_graph" };
    }
  }

  const depCell = findNearestWaterCell(bytes, routeDep.lat, routeDep.lon);
  const arrCell = findNearestWaterCell(bytes, routeArr.lat, routeArr.lon);

  if (depCell === null || arrCell === null) {
    logger.debug({
      operation: "schematic_router_direct_no_water",
      chordKm: Math.round(haversineKm(dep, arr)),
      durationMs: Date.now() - t0,
    });
    const composed = composeRouteWaypoints(
      dep,
      depApproach,
      [
        [routeDep.lon, routeDep.lat],
        [routeArr.lon, routeArr.lat],
      ],
      arrApproach,
      arr
    );
    return { ...composed, routed: false, method: "direct" };
  }

  const startIdx = cellIndex1(depCell.row, depCell.col);
  const goalIdx = cellIndex1(arrCell.row, arrCell.col);
  const pathCells = coarseAStar(bytes, startIdx, goalIdx);

  if (pathCells === null) {
    logger.debug({
      operation: "schematic_router_direct_disconnected",
      chordKm: Math.round(haversineKm(dep, arr)),
      durationMs: Date.now() - t0,
    });
    const composed = composeRouteWaypoints(
      dep,
      depApproach,
      [
        [routeDep.lon, routeDep.lat],
        [routeArr.lon, routeArr.lat],
      ],
      arrApproach,
      arr
    );
    return { ...composed, routed: false, method: "direct" };
  }

  const depCellCenter = cellCenter1(depCell.row, depCell.col);
  const arrCellCenter = cellCenter1(arrCell.row, arrCell.col);
  const depSnapKm = haversineKm(routeDep, depCellCenter);
  const arrSnapKm = haversineKm(routeArr, arrCellCenter);

  const rawPath: [number, number][] = [[routeDep.lon, routeDep.lat]];
  // Fjord-snap smoothing: when the snapped water cell is far from the
  // port (typical for fjord ports), insert a midpoint along the
  // port→snapped-cell line. Without this, the spline draws a sharp
  // elbow right at the port marker because the next waypoint is the
  // distant cell center.
  if (depSnapKm > FJORD_SNAP_THRESHOLD_KM) {
    rawPath.push([(routeDep.lon + depCellCenter.lon) / 2, (routeDep.lat + depCellCenter.lat) / 2]);
  }
  for (const idx of pathCells) {
    const c = cellCenter1(rowFromIndex1(idx), colFromIndex1(idx));
    rawPath.push([c.lon, c.lat]);
  }
  if (arrSnapKm > FJORD_SNAP_THRESHOLD_KM) {
    rawPath.push([(routeArr.lon + arrCellCenter.lon) / 2, (routeArr.lat + arrCellCenter.lat) / 2]);
  }
  rawPath.push([routeArr.lon, routeArr.lat]);

  const simplified = simplifyDegrees(rawPath, SIMPLIFY_TOLERANCE_DEG);
  const buffered = insertCoastBuffers(simplified, fineMaskBytes);
  const composed = composeRouteWaypoints(dep, depApproach, buffered, arrApproach, arr);

  logger.debug({
    operation: "schematic_router_routed",
    chordKm: Math.round(haversineKm(dep, arr)),
    depSnapKm: Math.round(depSnapKm),
    arrSnapKm: Math.round(arrSnapKm),
    rawWaypoints: rawPath.length,
    simplifiedWaypoints: simplified.length,
    bufferedWaypoints: buffered.length,
    outputWaypoints: composed.waypoints.length,
    departureApproachWaypoints: depApproach.length,
    arrivalApproachWaypoints: arrApproach.length,
    durationMs: Date.now() - t0,
  });
  return { ...composed, routed: true, method: "coarse_a_star" };
}
