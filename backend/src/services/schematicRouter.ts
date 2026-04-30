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

import { promises as fs } from 'fs';
import path from 'path';

import logger from '../utils/logger';
import { haversineKm } from '../shared/geo/haversine';
import { BinaryHeap } from '../shared/geo/binaryHeap';
import {
  MASK_COLS,
  MASK_ROWS,
  cellIndex,
  getBit,
  latToRow,
  lonToCol,
} from '../shared/geo/landMaskGrid';
import { routeMarnet } from './marnet/marnetRouter';

/** Look up whether a lat/lon is water on the FINE 0.1° mask. Used
 * only by the coast-buffer post-pass — A* itself runs on the coarse
 * grid. Returns `false` if the mask isn't loaded (caller invokes
 * `loadCoarseMask()` first anyway). */
function isFineWater(fineBytes: Uint8Array, lat: number, lon: number): boolean {
  if (lat < -90 || lat > 90) return false;
  const row = latToRow(lat);
  const col = lonToCol(lon);
  const c = ((col % MASK_COLS) + MASK_COLS) % MASK_COLS;
  if (row < 0 || row >= MASK_ROWS) return false;
  return getBit(fineBytes, cellIndex(row, c)) === 0;
}
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
} from '../shared/geo/landMaskGridCoarse';

const DEFAULT_FINE_MASK_PATH = path.resolve(__dirname, '..', '..', 'data', 'land-mask-0.1deg.bin');

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

export interface SchematicRoutePort {
  readonly id?: number;
  readonly name?: string | null;
  readonly city?: string | null;
  readonly country?: string | null;
  readonly unlocode?: string | null;
  readonly lat: number;
  readonly lon: number;
}

interface PortApproach {
  readonly match: (port: SchematicRoutePort) => boolean;
  /** [lon, lat] waypoints from the port toward open water, excluding the port itself. */
  readonly outbound: ReadonlyArray<readonly [number, number]>;
}

const PORT_APPROACHES: ReadonlyArray<PortApproach> = [
  {
    match: (port) => portMatches(port, {
      names: ['hamburg'],
      cities: ['hamburg'],
      countries: ['germany', 'deutschland'],
      unlocodes: ['DEHAM'],
    }),
    outbound: [
      [9.87, 53.54],
      [9.7, 53.56],
      [9.42, 53.79], // Glückstadt fairway (channel runs N of the town).
      [9.22, 53.86], // Brokdorf approach, channel-centered between river banks.
      [9.12, 53.88],
      [8.72, 53.9],
      [8.18, 54.05], // German Bight, safely outside the Elbe estuary.
    ],
  },
];

function normalizePortText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function portMatches(
  port: SchematicRoutePort,
  criteria: {
    readonly names?: readonly string[];
    readonly cities?: readonly string[];
    readonly countries?: readonly string[];
    readonly unlocodes?: readonly string[];
  },
): boolean {
  const name = normalizePortText(port.name);
  const city = normalizePortText(port.city);
  const country = normalizePortText(port.country);
  const unlocode = normalizePortText(port.unlocode).toUpperCase();

  if (criteria.unlocodes?.some((code) => unlocode === code.toUpperCase())) return true;

  const countryMatches =
    criteria.countries === undefined ||
    criteria.countries.some((candidate) => country === candidate);
  if (!countryMatches) return false;

  return Boolean(
    criteria.names?.some((candidate) => name === candidate || name.includes(candidate)) ||
      criteria.cities?.some((candidate) => city === candidate),
  );
}

function getPortApproach(port: SchematicRoutePort): [number, number][] {
  const approach = PORT_APPROACHES.find((entry) => entry.match(port));
  return approach ? approach.outbound.map(([lon, lat]) => [lon, lat]) : [];
}

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
  arr: SchematicRoutePort,
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

/** Downsample the 0.1° raster to 1°. A 1° cell is water when
 * COARSE_WATER_THRESHOLD of its 100 sub-cells are water. */
function downsampleMask(finBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(MASK1_BYTES);
  for (let row = 0; row < MASK1_ROWS; row++) {
    const fineRowStart = row * 10;
    for (let col = 0; col < MASK1_COLS; col++) {
      const fineColStart = col * 10;
      let water = 0;
      for (let dr = 0; dr < 10; dr++) {
        const fr = fineRowStart + dr;
        if (fr >= MASK_ROWS) continue;
        for (let dc = 0; dc < 10; dc++) {
          const fc = (fineColStart + dc) % MASK_COLS;
          if (getBit(finBytes, cellIndex(fr, fc)) === 0) water++;
        }
      }
      const isWater = water / 100 >= COARSE_WATER_THRESHOLD;
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
        operation: 'schematic_router_mask_built',
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

export function setCoarseMaskForTesting(
  bytes: Uint8Array | null,
  fine?: Uint8Array | null,
): void {
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
  maxCells = 500,
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

function coarseAStar(
  bytes: Uint8Array,
  startIdx: number,
  goalIdx: number,
): number[] | null {
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
 * Douglas-Peucker polyline simplification — drops vertices whose
 * perpendicular distance from the chord between kept vertices is
 * below `toleranceDeg`. Operates in degree space since the output is
 * rendered by a spline that doesn't need metre-accurate vertex
 * placement. Keeps first and last vertices unconditionally.
 */
export function simplifyDegrees(
  points: ReadonlyArray<[number, number]>,
  toleranceDeg: number,
): [number, number][] {
  if (points.length <= 2) return points.slice() as [number, number][];

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number];
    if (hi - lo < 2) continue;
    let maxDist = 0;
    let maxIdx = -1;
    const [x0, y0] = points[lo];
    const [x1, y1] = points[hi];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segLen2 = dx * dx + dy * dy || 1;
    for (let k = lo + 1; k < hi; k++) {
      const [xk, yk] = points[k];
      const t = ((xk - x0) * dx + (yk - y0) * dy) / segLen2;
      const tc = Math.max(0, Math.min(1, t));
      const px = x0 + tc * dx;
      const py = y0 + tc * dy;
      const d = Math.hypot(xk - px, yk - py);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = k;
      }
    }
    if (maxDist > toleranceDeg && maxIdx !== -1) {
      keep[maxIdx] = true;
      stack.push([lo, maxIdx]);
      stack.push([maxIdx, hi]);
    }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Walk each simplified segment at ~0.2° step granularity on the fine
 * 0.1° mask; if the midpoint (or any sampled point) clips land,
 * insert an offshore "buffer" waypoint that pulls the segment out to
 * sea. Runs AFTER Douglas-Peucker so we only buffer segments that
 * actually survived simplification — avoids re-densifying long
 * already-dense continental curves.
 *
 * The buffer direction is chosen by searching a small cloud of
 * offshore candidates perpendicular to the segment and picking the
 * one that gets the whole segment back over water. Cheap because the
 * candidate set is small and the 0.1° mask lookup is O(1).
 */
function insertCoastBuffers(
  waypoints: ReadonlyArray<[number, number]>,
  fineBytes: Uint8Array | null,
): [number, number][] {
  if (fineBytes === null || waypoints.length < 2) {
    return waypoints.slice() as [number, number][];
  }
  const out: [number, number][] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const [lon0, lat0] = waypoints[i - 1];
    const [lon1, lat1] = waypoints[i];
    const dx = lon1 - lon0;
    const dy = lat1 - lat0;
    const segLen = Math.hypot(dx, dy);
    // Short segments (< 0.5° ≈ 55 km) are too coastal-noisy to buffer
    // usefully, and the spline's natural curvature handles them.
    if (segLen < 0.5) {
      out.push([lon1, lat1]);
      continue;
    }
    // Sample the segment at 0.15° intervals. If any interior sample
    // lands on land, we need a buffer.
    const samples = Math.max(3, Math.ceil(segLen / 0.15));
    let anyLand = false;
    for (let s = 1; s < samples; s++) {
      const t = s / samples;
      const lon = lon0 + dx * t;
      const lat = lat0 + dy * t;
      if (!isFineWater(fineBytes, lat, lon)) {
        anyLand = true;
        break;
      }
    }
    if (!anyLand) {
      out.push([lon1, lat1]);
      continue;
    }
    // Find an offshore buffer point near the midpoint. Perpendicular
    // vector to the chord, tested in both directions at increasing
    // offset. Cell-size bumps (0.5° steps up to 2°) are enough for
    // continental-scale routing; larger offsets would bend the curve
    // too far.
    const midLon = (lon0 + lon1) / 2;
    const midLat = (lat0 + lat1) / 2;
    const perpNorm = Math.hypot(dx, dy) || 1;
    const perpLon = -dy / perpNorm;
    const perpLat = dx / perpNorm;
    let bestBuffer: [number, number] | null = null;
    for (const magnitude of [0.5, 1.0, 1.5, 2.0]) {
      for (const sign of [1, -1] as const) {
        const bufLon = midLon + sign * perpLon * magnitude;
        const bufLat = midLat + sign * perpLat * magnitude;
        // Accept the buffer only if: (a) it is itself on water, and
        // (b) the two sub-segments (start→buf, buf→end) both stay in
        // water when re-sampled. Otherwise it's still a bad route.
        if (!isFineWater(fineBytes, bufLat, bufLon)) continue;
        if (!segmentAllWater(fineBytes, lon0, lat0, bufLon, bufLat)) continue;
        if (!segmentAllWater(fineBytes, bufLon, bufLat, lon1, lat1)) continue;
        bestBuffer = [bufLon, bufLat];
        break;
      }
      if (bestBuffer !== null) break;
    }
    if (bestBuffer !== null) out.push(bestBuffer);
    out.push([lon1, lat1]);
  }
  return out;
}

function segmentAllWater(
  fineBytes: Uint8Array,
  lon0: number,
  lat0: number,
  lon1: number,
  lat1: number,
): boolean {
  const dx = lon1 - lon0;
  const dy = lat1 - lat0;
  const segLen = Math.hypot(dx, dy);
  const samples = Math.max(3, Math.ceil(segLen / 0.15));
  for (let s = 1; s < samples; s++) {
    const t = s / samples;
    if (!isFineWater(fineBytes, lat0 + dy * t, lon0 + dx * t)) return false;
  }
  return true;
}

function segmentMaxLandRun(
  fineBytes: Uint8Array,
  lon0: number,
  lat0: number,
  lon1: number,
  lat1: number,
): number {
  const dx = lon1 - lon0;
  const dy = lat1 - lat0;
  const segLen = Math.hypot(dx, dy);
  const samples = Math.max(3, Math.ceil(segLen / 0.15));
  let currentRun = 0;
  let maxRun = 0;
  for (let s = 1; s < samples; s++) {
    const t = s / samples;
    if (!isFineWater(fineBytes, lat0 + dy * t, lon0 + dx * t)) {
      currentRun++;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return maxRun;
}

async function computeMaritimeGraphRoute(
  dep: { lat: number; lon: number },
  arr: { lat: number; lon: number },
  fineBytes: Uint8Array | null,
): Promise<[number, number][] | null> {
  try {
    const chordKm = haversineKm(dep, arr);
    // Marnet's nearest shipping-lane node is often 30-80 km from a port
    // (Kiel, Lübeck, Stockholm, Oslo, fjord ports). The budget
    // (100 km floor / 500 km cap / 35 % of chord) is permissive enough
    // to keep marnet results for every realistic landlocked-port
    // pairing while still vetoing nonsense snaps.
    const snapBudgetKm = Math.min(500, Math.max(100, chordKm * 0.35));
    const route = await routeMarnet(dep, arr, { maxSnapKm: snapBudgetKm });
    if (route === null) return null;
    const coords = route.coords.map(([lon, lat]) => [lon, lat] as [number, number]);
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
      if (segmentMaxLandRun(fineBytes, lon0, lat0, lon1, lat1) >= 10) return null;
    }
    return repaired;
  } catch {
    return null;
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
  readonly method: 'short_hop' | 'maritime_graph' | 'coarse_a_star' | 'direct';
}

/**
 * In-memory LRU cache for computed routes. The schematic algorithm is
 * fast on its own (~1-5ms per leg on the 1° grid), but the dashboard
 * loads geometry for every cruise on mount — for a user with 50 cruises
 * × ~10 legs each that's still ~500 cell-lookups + simplify + buffer
 * passes per page-view, plus the per-request DB roundtrip. Caching the
 * computed `SchematicRoute` by directional (depId, arrId) key drops
 * subsequent loads to a Map.get.
 *
 * Cache key is null when either port lacks an `id` (pure ad-hoc lookup,
 * not worth caching). LRU eviction at ROUTE_CACHE_MAX entries; on
 * overflow the oldest insertion is dropped. No TTL — routes are
 * deterministic given (port coordinates, algorithm version), and a
 * server restart clears the cache anyway.
 */
const ROUTE_CACHE_MAX = 5000;
const routeCache = new Map<string, SchematicRoute>();
let routeCacheHits = 0;
let routeCacheMisses = 0;

function routeCacheKey(
  dep: SchematicRoutePort,
  arr: SchematicRoutePort,
): string | null {
  if (dep.id === undefined || arr.id === undefined) return null;
  return `${dep.id}->${arr.id}`;
}

export function getSchematicRouteCacheStats(): {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
} {
  const total = routeCacheHits + routeCacheMisses;
  return {
    size: routeCache.size,
    hits: routeCacheHits,
    misses: routeCacheMisses,
    hitRate: total === 0 ? 0 : routeCacheHits / total,
  };
}

export function clearSchematicRouteCache(): void {
  routeCache.clear();
  routeCacheHits = 0;
  routeCacheMisses = 0;
}

/**
 * Compute a schematic waypoint list between two ports. Always
 * returns — even in pathological cases (landlocked ports, mask
 * inconsistencies) you get `{waypoints: [dep, arr], routed: false}`,
 * which the frontend can still render as a straight link.
 *
 * Cached: identical (dep.id, arr.id) pairs return the prior result
 * without re-running A*. See ROUTE_CACHE_MAX above.
 */
export async function computeSchematicRoute(
  dep: SchematicRoutePort,
  arr: SchematicRoutePort,
): Promise<SchematicRoute> {
  const key = routeCacheKey(dep, arr);
  if (key !== null) {
    const cached = routeCache.get(key);
    if (cached) {
      // LRU bump: re-insert to mark as most-recently-used.
      routeCache.delete(key);
      routeCache.set(key, cached);
      routeCacheHits++;
      return cached;
    }
    routeCacheMisses++;
  }

  const result = await computeSchematicRouteUncached(dep, arr);

  if (key !== null) {
    if (routeCache.size >= ROUTE_CACHE_MAX) {
      // Evict the oldest entry. Map preserves insertion order, so the
      // first key in the iterator is the least-recently inserted/bumped.
      const oldest = routeCache.keys().next().value;
      if (oldest !== undefined) routeCache.delete(oldest);
    }
    routeCache.set(key, result);
  }
  return result;
}

async function computeSchematicRouteUncached(
  dep: SchematicRoutePort,
  arr: SchematicRoutePort,
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
      [[routeDep.lon, routeDep.lat], [routeArr.lon, routeArr.lat]],
      arrApproach,
      arr,
    );
    logger.debug({
      operation: 'schematic_router_short_hop',
      chordKm: Math.round(chordKm),
      outputWaypoints: composed.waypoints.length,
      durationMs: Date.now() - t0,
    });
    return { ...composed, routed: true, method: 'short_hop' };
  }

  if (fineMaskBytes !== null) {
    const maritimeGraphRoute = await computeMaritimeGraphRoute(routeDep, routeArr, fineMaskBytes);
    if (maritimeGraphRoute !== null) {
      const composed = composeRouteWaypoints(dep, depApproach, maritimeGraphRoute, arrApproach, arr);
      logger.debug({
        operation: 'schematic_router_maritime_graph',
        chordKm: Math.round(chordKm),
        graphWaypoints: maritimeGraphRoute.length,
        outputWaypoints: composed.waypoints.length,
        departureApproachWaypoints: depApproach.length,
        arrivalApproachWaypoints: arrApproach.length,
        durationMs: Date.now() - t0,
      });
      return { ...composed, routed: true, method: 'maritime_graph' };
    }
  }

  const depCell = findNearestWaterCell(bytes, routeDep.lat, routeDep.lon);
  const arrCell = findNearestWaterCell(bytes, routeArr.lat, routeArr.lon);

  if (depCell === null || arrCell === null) {
    logger.debug({
      operation: 'schematic_router_direct_no_water',
      chordKm: Math.round(haversineKm(dep, arr)),
      durationMs: Date.now() - t0,
    });
    const composed = composeRouteWaypoints(
      dep,
      depApproach,
      [[routeDep.lon, routeDep.lat], [routeArr.lon, routeArr.lat]],
      arrApproach,
      arr,
    );
    return { ...composed, routed: false, method: 'direct' };
  }

  const startIdx = cellIndex1(depCell.row, depCell.col);
  const goalIdx = cellIndex1(arrCell.row, arrCell.col);
  const pathCells = coarseAStar(bytes, startIdx, goalIdx);

  if (pathCells === null) {
    logger.debug({
      operation: 'schematic_router_direct_disconnected',
      chordKm: Math.round(haversineKm(dep, arr)),
      durationMs: Date.now() - t0,
    });
    const composed = composeRouteWaypoints(
      dep,
      depApproach,
      [[routeDep.lon, routeDep.lat], [routeArr.lon, routeArr.lat]],
      arrApproach,
      arr,
    );
    return { ...composed, routed: false, method: 'direct' };
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
    rawPath.push([
      (routeDep.lon + depCellCenter.lon) / 2,
      (routeDep.lat + depCellCenter.lat) / 2,
    ]);
  }
  for (const idx of pathCells) {
    const c = cellCenter1(rowFromIndex1(idx), colFromIndex1(idx));
    rawPath.push([c.lon, c.lat]);
  }
  if (arrSnapKm > FJORD_SNAP_THRESHOLD_KM) {
    rawPath.push([
      (routeArr.lon + arrCellCenter.lon) / 2,
      (routeArr.lat + arrCellCenter.lat) / 2,
    ]);
  }
  rawPath.push([routeArr.lon, routeArr.lat]);

  const simplified = simplifyDegrees(rawPath, SIMPLIFY_TOLERANCE_DEG);
  const buffered = insertCoastBuffers(simplified, fineMaskBytes);
  const composed = composeRouteWaypoints(dep, depApproach, buffered, arrApproach, arr);

  logger.debug({
    operation: 'schematic_router_routed',
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
  return { ...composed, routed: true, method: 'coarse_a_star' };
}
