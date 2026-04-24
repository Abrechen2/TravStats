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

let maskBytes: Uint8Array | null = null;
let fineMaskBytes: Uint8Array | null = null;
let loadPromise: Promise<Uint8Array> | null = null;

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
      [9.52, 53.86], // Elbe fairway near Brunsbuettel/Cuxhaven approach
      [8.72, 53.9],  // Cuxhaven roads
      [8.18, 54.05], // German Bight, safely outside the Elbe estuary
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

function composeRouteWaypoints(
  dep: SchematicRoutePort,
  depApproach: ReadonlyArray<[number, number]>,
  coreWaypoints: ReadonlyArray<[number, number]>,
  arrApproach: ReadonlyArray<[number, number]>,
  arr: SchematicRoutePort,
): [number, number][] {
  const out: [number, number][] = [];
  appendUnique(out, [dep.lon, dep.lat]);
  for (const point of depApproach) appendUnique(out, point);
  for (const point of coreWaypoints) appendUnique(out, point);
  for (const point of [...arrApproach].reverse()) appendUnique(out, point);
  appendUnique(out, [arr.lon, arr.lat]);
  return out;
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

export interface SchematicRoute {
  /** [lon, lat] waypoints. First is always `dep`, last is always
   * `arr`. Intermediates are continental-scale detours around
   * landmasses (usually 0-5 of them). Frontend splines through
   * these to get the final curve. */
  readonly waypoints: [number, number][];
  /** True when A* found a coarse water path; false when ports were on
   * disconnected components and we fell back to a direct chord. The
   * frontend renders both identically — the flag is informational,
   * letting callers surface a "direct line" badge if desired. */
  readonly routed: boolean;
}

/**
 * Compute a schematic waypoint list between two ports. Always
 * returns — even in pathological cases (landlocked ports, mask
 * inconsistencies) you get `{waypoints: [dep, arr], routed: false}`,
 * which the frontend can still render as a straight link.
 */
export async function computeSchematicRoute(
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

  const depCell = findNearestWaterCell(bytes, routeDep.lat, routeDep.lon);
  const arrCell = findNearestWaterCell(bytes, routeArr.lat, routeArr.lon);

  if (depCell === null || arrCell === null) {
    logger.debug({
      operation: 'schematic_router_direct_no_water',
      chordKm: Math.round(haversineKm(dep, arr)),
      durationMs: Date.now() - t0,
    });
    return {
      waypoints: composeRouteWaypoints(
        dep,
        depApproach,
        [[routeDep.lon, routeDep.lat], [routeArr.lon, routeArr.lat]],
        arrApproach,
        arr,
      ),
      routed: false,
    };
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
    return {
      waypoints: composeRouteWaypoints(
        dep,
        depApproach,
        [[routeDep.lon, routeDep.lat], [routeArr.lon, routeArr.lat]],
        arrApproach,
        arr,
      ),
      routed: false,
    };
  }

  const rawPath: [number, number][] = [[routeDep.lon, routeDep.lat]];
  for (const idx of pathCells) {
    const c = cellCenter1(rowFromIndex1(idx), colFromIndex1(idx));
    rawPath.push([c.lon, c.lat]);
  }
  rawPath.push([routeArr.lon, routeArr.lat]);

  const simplified = simplifyDegrees(rawPath, SIMPLIFY_TOLERANCE_DEG);
  const buffered = insertCoastBuffers(simplified, fineMaskBytes);
  const waypoints = composeRouteWaypoints(dep, depApproach, buffered, arrApproach, arr);

  logger.debug({
    operation: 'schematic_router_routed',
    chordKm: Math.round(haversineKm(dep, arr)),
    rawWaypoints: rawPath.length,
    simplifiedWaypoints: simplified.length,
    bufferedWaypoints: buffered.length,
    outputWaypoints: waypoints.length,
    departureApproachWaypoints: depApproach.length,
    arrivalApproachWaypoints: arrApproach.length,
    durationMs: Date.now() - t0,
  });
  return { waypoints, routed: true };
}
