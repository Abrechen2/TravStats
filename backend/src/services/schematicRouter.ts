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
 * on the 0.1° mask is water. Liberal on purpose — coastal 1° cells
 * should be passable by a schematic route even when they're mostly
 * land, because the spline will bend the rendered curve away from the
 * cell centre anyway. Value tuned empirically: higher (say 0.5) makes
 * Mediterranean / Baltic legs route via impossible paths; lower
 * (say 0.1) lets routes cut across continental shelves. */
const COARSE_WATER_THRESHOLD = 0.3;

/** Maximum A* cells visited before giving up. 1° grid is 64 800 cells
 * total; even worst-case transoceanic routes visit <10k cells with a
 * haversine heuristic. */
const COARSE_A_STAR_BUDGET = 50_000;

/** Douglas-Peucker simplification tolerance, in degrees. Rough rule of
 * thumb: a vertex deviates from the chord it replaces by at most this
 * much before it's kept. 0.8° ≈ 90 km at the equator — enough to
 * preserve continental-scale detours (around Italy, around Spain) and
 * drop cell-grid zig-zag. */
const SIMPLIFY_TOLERANCE_DEG = 0.8;

let maskBytes: Uint8Array | null = null;
let loadPromise: Promise<Uint8Array> | null = null;

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

export function setCoarseMaskForTesting(bytes: Uint8Array | null): void {
  maskBytes = bytes;
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
  dep: { lat: number; lon: number },
  arr: { lat: number; lon: number },
): Promise<SchematicRoute> {
  const t0 = Date.now();
  const bytes = await loadCoarseMask();

  const depCell = findNearestWaterCell(bytes, dep.lat, dep.lon);
  const arrCell = findNearestWaterCell(bytes, arr.lat, arr.lon);

  if (depCell === null || arrCell === null) {
    logger.debug({
      operation: 'schematic_router_direct_no_water',
      chordKm: Math.round(haversineKm(dep, arr)),
      durationMs: Date.now() - t0,
    });
    return { waypoints: [[dep.lon, dep.lat], [arr.lon, arr.lat]], routed: false };
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
    return { waypoints: [[dep.lon, dep.lat], [arr.lon, arr.lat]], routed: false };
  }

  const rawPath: [number, number][] = [[dep.lon, dep.lat]];
  for (const idx of pathCells) {
    const c = cellCenter1(rowFromIndex1(idx), colFromIndex1(idx));
    rawPath.push([c.lon, c.lat]);
  }
  rawPath.push([arr.lon, arr.lat]);

  const simplified = simplifyDegrees(rawPath, SIMPLIFY_TOLERANCE_DEG);

  logger.debug({
    operation: 'schematic_router_routed',
    chordKm: Math.round(haversineKm(dep, arr)),
    rawWaypoints: rawPath.length,
    simplifiedWaypoints: simplified.length,
    durationMs: Date.now() - t0,
  });
  return { waypoints: simplified, routed: true };
}
