/**
 * seaRouter.ts — A* sea-route finder over the packed land/water bit
 * grid written by `scripts/generate-land-mask.ts`.
 *
 * Public surface:
 *   - `loadLandMask()`    — lazy load + cache of the binary grid.
 *   - `isWater(lat, lon)` — O(1) water check at a coordinate.
 *   - `findNearestWater(lat, lon, maxCells)` — BFS outward from the
 *     cell, returns the closest water cell centre coordinate or null
 *     when nothing found within the budget.
 *   - `computeSeaRoute(dep, arr)` — A* between two water cells,
 *     returns a GeoJSON-style `[lon, lat][]` polyline or null when
 *     unreachable (e.g. port snapped inland).
 *
 * The module is pure besides the one file read and one logger call;
 * no Express / Prisma imports so the A* code can be unit-tested with
 * a hand-crafted 10×10 grid.
 *
 * Phase 1 of the cruise-map-V2 plan — canal overrides (Phase 2) are
 * not yet wired. Simplification, caching, and backfill arrive in
 * later phases.
 */

import { promises as fs } from 'fs';
import path from 'path';

import logger from '../utils/logger';
import { haversineKm } from '../shared/geo/haversine';
import { BinaryHeap } from '../shared/geo/binaryHeap';
import {
  MASK_BYTES,
  MASK_CELL_DEG,
  MASK_COLS,
  MASK_ROWS,
  MASK_TOTAL_CELLS,
  cellCenter,
  cellIndex,
  colFromIndex,
  getBit,
  setBit,
  latToRow,
  lonToCol,
  rowFromIndex,
} from '../shared/geo/landMaskGrid';
import { CANAL_OVERRIDES, type CanalOverride } from './seaCanals';

/** Default on-disk location of the packed land mask. */
const DEFAULT_MASK_PATH = path.resolve(__dirname, '..', '..', 'data', 'land-mask-0.1deg.bin');

/** Maximum cells visited during a single A* run. Belt-and-braces guard
 * against a pathological raster / canal edit that would make A*
 * explore the whole globe (6.48 M cells). The heuristic normally
 * keeps visited counts well under 200 k even for a transatlantic. */
const MAX_A_STAR_VISITED = 2_000_000;

/** 8-neighbour step table — dr / dc pairs. Cost scales with
 * haversine at runtime (see `neighbourKm`); we only keep the dr/dc
 * direction here. */
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

// ---------------------------------------------------------------------------
// Land-mask state
// ---------------------------------------------------------------------------

interface MaskState {
  bytes: Uint8Array;
  sourcePath: string;
}

let maskState: MaskState | null = null;
let loadPromise: Promise<MaskState> | null = null;

/**
 * Swap in a prebuilt mask (tests only). Passing `null` reverts to the
 * default lazy disk load on the next `loadLandMask()` call.
 *
 * The bytes are written through `applyCanalOverrides` on the way in so
 * tests get the same canal-patched view production uses. Pass the
 * second argument `{ skipCanals: true }` when testing the raster
 * itself without canal modifications.
 */
export function setLandMaskForTesting(
  bytes: Uint8Array | null,
  options: { skipCanals?: boolean } = {},
): void {
  if (bytes === null) {
    maskState = null;
    loadPromise = null;
    return;
  }
  if (bytes.byteLength !== MASK_BYTES) {
    throw new Error(
      `Test mask has ${bytes.byteLength} bytes, expected ${MASK_BYTES}`,
    );
  }
  const patched = options.skipCanals ? bytes : applyCanalOverrides(bytes);
  maskState = { bytes: patched, sourcePath: '<in-memory>' };
  loadPromise = null;
}

/**
 * Lazy-load the packed land mask. First call reads the file; later
 * calls return the cached bytes. Rejects with a helpful message when
 * the binary is missing — almost certainly means
 * `scripts/generate-land-mask.ts` has not been run.
 */
export async function loadLandMask(): Promise<Uint8Array> {
  if (maskState !== null) return maskState.bytes;
  if (loadPromise === null) {
    loadPromise = (async (): Promise<MaskState> => {
      const targetPath = DEFAULT_MASK_PATH;
      const buf = await fs.readFile(targetPath);
      if (buf.byteLength !== MASK_BYTES) {
        throw new Error(
          `Land-mask at ${targetPath} has ${buf.byteLength} bytes, expected ${MASK_BYTES}`,
        );
      }
      const rawBytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      // applyCanalOverrides copies the buffer so the on-disk file stays
      // untouched and multiple test-driven mask swaps never stack.
      const patchedBytes = applyCanalOverrides(rawBytes);
      maskState = { bytes: patchedBytes, sourcePath: targetPath };
      logger.info({
        operation: 'sea_router_mask_loaded',
        path: targetPath,
        bytes: buf.byteLength,
        canalOverrides: CANAL_OVERRIDES.length,
      });
      return maskState;
    })();
  }
  const state = await loadPromise;
  return state.bytes;
}

function requireMask(): Uint8Array {
  if (maskState === null) {
    throw new Error('Land mask not loaded — call loadLandMask() first');
  }
  return maskState.bytes;
}

// ---------------------------------------------------------------------------
// Canal / strait overrides
// ---------------------------------------------------------------------------

/**
 * Return a copy of `rawBytes` with every canal + strait in
 * `CANAL_OVERRIDES` painted as water. Called once at mask-load time so
 * every subsequent `isWater` / A* lookup is O(1) — no per-request cost.
 *
 * The copy is mandatory: the input `rawBytes` may be a view on a
 * read-only disk buffer (Node shares the underlying ArrayBuffer for
 * `fs.readFile` results) and we also swap masks across tests.
 */
export function applyCanalOverrides(rawBytes: Uint8Array): Uint8Array {
  const patched = new Uint8Array(rawBytes.byteLength);
  patched.set(rawBytes);
  for (const canal of CANAL_OVERRIDES) {
    paintCanalAxis(patched, canal);
  }
  return patched;
}

/**
 * Walk the polyline of a canal override and force every grid cell the
 * line passes through to water. Each segment is walked cell-by-cell
 * using `max(|dRow|, |dCol|)` steps — i.e. a grid-aligned DDA that
 * guarantees the resulting water chain is 8-connected (so A* can
 * actually traverse it).
 */
function paintCanalAxis(bytes: Uint8Array, canal: CanalOverride): void {
  const axis = canal.axis;
  if (axis.length < 2) return;
  for (let i = 0; i < axis.length - 1; i++) {
    paintCanalSegment(bytes, axis[i], axis[i + 1]);
  }
}

function paintCanalSegment(
  bytes: Uint8Array,
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): void {
  const rowA = latToRow(a.lat);
  const colA = lonToCol(a.lon);
  const rowB = latToRow(b.lat);
  const colB = lonToCol(b.lon);
  const dRow = rowB - rowA;
  const dCol = colB - colA;
  const steps = Math.max(Math.abs(dRow), Math.abs(dCol));
  if (steps === 0) {
    setBit(bytes, cellIndex(rowA, colA), 0);
    return;
  }
  // Paint the line AND its 4-neighbourhood so the resulting water
  // corridor is wider than a single cell — A* 8-neighbour moves diagonal
  // across single-cell gaps correctly, but real canal ships need a bit
  // more tolerance around sharp bends in the axis polyline.
  for (let step = 0; step <= steps; step++) {
    const row = Math.round(rowA + (dRow * step) / steps);
    const col = Math.round(colA + (dCol * step) / steps);
    paintCellAndBrush(bytes, row, col);
  }
}

function paintCellAndBrush(bytes: Uint8Array, row: number, col: number): void {
  for (let dr = -1; dr <= 1; dr++) {
    const r = row + dr;
    if (r < 0 || r >= MASK_ROWS) continue;
    for (let dc = -1; dc <= 1; dc++) {
      const c = ((col + dc) % MASK_COLS + MASK_COLS) % MASK_COLS;
      setBit(bytes, cellIndex(r, c), 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Cell-level primitives
// ---------------------------------------------------------------------------

/**
 * True when the given cell is water (or off-grid — the grid wraps for
 * lon, clamps for lat).
 */
function cellIsWater(bytes: Uint8Array, row: number, col: number): boolean {
  if (row < 0 || row >= MASK_ROWS) return false;
  // Longitude wraps; cols are already in 0..MASK_COLS-1 because callers
  // normalise before passing in, but guard anyway.
  const c = ((col % MASK_COLS) + MASK_COLS) % MASK_COLS;
  return getBit(bytes, cellIndex(row, c)) === 0;
}

/**
 * Boolean water-check on a real-world coordinate. Used to decide
 * whether a port needs snapping. Returns `false` when the mask is not
 * loaded — callers should `await loadLandMask()` first.
 */
export function isWater(lat: number, lon: number): boolean {
  if (maskState === null) {
    throw new Error('Land mask not loaded — call loadLandMask() first');
  }
  const row = latToRow(lat);
  const col = lonToCol(lon);
  return cellIsWater(maskState.bytes, row, col);
}

/**
 * BFS outward from the port's cell until we find a water cell.
 * Guarantees we return the *nearest* water cell (ties broken by BFS
 * insertion order). Visit budget is `maxCells` neighbours — 50 by
 * default ≈ 550 km which is enough to snap terminal coords onto the
 * harbour but stops us from finding an ocean when the port is inland.
 *
 * Returns the water cell's *centre* coordinate, which is always
 * on-grid and therefore safe to pass into A*.
 */
export function findNearestWater(
  lat: number,
  lon: number,
  maxCells = 50,
): { lat: number; lon: number } | null {
  const bytes = requireMask();
  const startRow = latToRow(lat);
  const startCol = lonToCol(lon);

  if (cellIsWater(bytes, startRow, startCol)) {
    return cellCenter(startRow, startCol);
  }

  const visited = new Uint8Array(MASK_TOTAL_CELLS);
  const queue: number[] = [cellIndex(startRow, startCol)];
  visited[queue[0]] = 1;

  let explored = 0;
  let head = 0;
  while (head < queue.length && explored < maxCells) {
    const idx = queue[head++];
    const row = rowFromIndex(idx);
    const col = colFromIndex(idx);
    explored++;

    for (const [dr, dc] of NEIGHBOUR_STEPS) {
      const nr = row + dr;
      if (nr < 0 || nr >= MASK_ROWS) continue;
      const nc = ((col + dc) % MASK_COLS + MASK_COLS) % MASK_COLS;
      const nIdx = cellIndex(nr, nc);
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      if (cellIsWater(bytes, nr, nc)) {
        return cellCenter(nr, nc);
      }
      queue.push(nIdx);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------

interface AStarNode {
  index: number;
  f: number; // g + h
}

/** Real-world km between two cell centres. Used for edge cost and heuristic. */
function cellDistanceKm(aIdx: number, bIdx: number): number {
  const a = cellCenter(rowFromIndex(aIdx), colFromIndex(aIdx));
  const b = cellCenter(rowFromIndex(bIdx), colFromIndex(bIdx));
  return haversineKm(a, b);
}

/** Reconstruct the cell-index path by walking the `cameFrom` map. */
function reconstructPath(cameFrom: Int32Array, goalIdx: number): number[] {
  const path: number[] = [goalIdx];
  let cursor = goalIdx;
  while (cameFrom[cursor] !== -1) {
    cursor = cameFrom[cursor];
    path.push(cursor);
  }
  path.reverse();
  return path;
}

interface ComputeOptions {
  /**
   * Hard cap on cells pulled from the heap. Tests may want a small
   * budget; production uses MAX_A_STAR_VISITED.
   */
  readonly maxVisited?: number;
}

/**
 * Raw A* between two cell indices. Returns a cell-index path or null
 * if unreachable within the visit budget. Separated from the
 * coordinate-facing API so tests can use a tiny synthetic grid.
 */
export function computeSeaRouteCells(
  bytes: Uint8Array,
  startIdx: number,
  goalIdx: number,
  options: ComputeOptions = {},
): number[] | null {
  const maxVisited = options.maxVisited ?? MAX_A_STAR_VISITED;

  if (startIdx === goalIdx) return [startIdx];

  // Guard: start / goal must both be water.
  const startRow = rowFromIndex(startIdx);
  const startCol = colFromIndex(startIdx);
  const goalRow = rowFromIndex(goalIdx);
  const goalCol = colFromIndex(goalIdx);
  if (!cellIsWater(bytes, startRow, startCol)) return null;
  if (!cellIsWater(bytes, goalRow, goalCol)) return null;

  // gScore — best known cost from start to each cell. `Infinity` when
  // unseen, stored in a Float64Array for speed. 6.48 M × 8 bytes = 52 MB
  // which is fine for a single-threaded request (one allocation, not
  // per-request-growth). Closed set uses a Uint8Array so we can ask
  // "have we settled this cell" without another allocation.
  const N = MASK_TOTAL_CELLS;
  const gScore = new Float64Array(N);
  gScore.fill(Infinity);
  const closed = new Uint8Array(N);
  const cameFrom = new Int32Array(N);
  cameFrom.fill(-1);

  gScore[startIdx] = 0;

  const open = new BinaryHeap<AStarNode>((n) => n.f);
  const startF = cellDistanceKm(startIdx, goalIdx);
  open.push({ index: startIdx, f: startF });

  let visited = 0;
  while (open.size > 0 && visited < maxVisited) {
    const current = open.pop() as AStarNode;
    const curIdx = current.index;
    if (closed[curIdx]) continue;
    closed[curIdx] = 1;
    visited++;

    if (curIdx === goalIdx) {
      return reconstructPath(cameFrom, goalIdx);
    }

    const curRow = rowFromIndex(curIdx);
    const curCol = colFromIndex(curIdx);
    const curG = gScore[curIdx];

    for (const [dr, dc] of NEIGHBOUR_STEPS) {
      const nr = curRow + dr;
      if (nr < 0 || nr >= MASK_ROWS) continue;
      const nc = ((curCol + dc) % MASK_COLS + MASK_COLS) % MASK_COLS;
      const nIdx = cellIndex(nr, nc);
      if (closed[nIdx]) continue;
      if (!cellIsWater(bytes, nr, nc)) continue;

      const stepKm = cellDistanceKm(curIdx, nIdx);
      const tentativeG = curG + stepKm;
      if (tentativeG >= gScore[nIdx]) continue;

      gScore[nIdx] = tentativeG;
      cameFrom[nIdx] = curIdx;
      const h = cellDistanceKm(nIdx, goalIdx);
      open.push({ index: nIdx, f: tentativeG + h });
    }
  }

  return null;
}

export interface SeaRoutePoint {
  readonly lat: number;
  readonly lon: number;
}

export interface SeaRouteLineString {
  readonly type: 'LineString';
  readonly coordinates: [number, number][];
}

/**
 * High-level entry point: compute a water-only route between two
 * real-world coordinates. Both endpoints are snapped to the nearest
 * water cell via BFS (up to 50 cells / ≈ 550 km) before A* runs.
 *
 * Returns a GeoJSON LineString with [lon, lat] vertices, or null if:
 *   - either port cannot be snapped to water within the 50-cell budget
 *   - the ports are on disconnected seas (A* exhausts its visit cap)
 *   - the mask file is not present (will throw before we get here; we
 *     treat that as a programmer error, not a null)
 */
export async function computeSeaRoute(
  dep: SeaRoutePoint,
  arr: SeaRoutePoint,
): Promise<SeaRouteLineString | null> {
  const bytes = await loadLandMask();

  const depSnap = cellIsWater(bytes, latToRow(dep.lat), lonToCol(dep.lon))
    ? { lat: dep.lat, lon: dep.lon }
    : findNearestWater(dep.lat, dep.lon);
  if (!depSnap) {
    logger.warn({
      operation: 'sea_router_snap_failed',
      endpoint: 'dep',
      lat: dep.lat,
      lon: dep.lon,
    });
    return null;
  }

  const arrSnap = cellIsWater(bytes, latToRow(arr.lat), lonToCol(arr.lon))
    ? { lat: arr.lat, lon: arr.lon }
    : findNearestWater(arr.lat, arr.lon);
  if (!arrSnap) {
    logger.warn({
      operation: 'sea_router_snap_failed',
      endpoint: 'arr',
      lat: arr.lat,
      lon: arr.lon,
    });
    return null;
  }

  const startIdx = cellIndex(latToRow(depSnap.lat), lonToCol(depSnap.lon));
  const goalIdx = cellIndex(latToRow(arrSnap.lat), lonToCol(arrSnap.lon));

  const cells = computeSeaRouteCells(bytes, startIdx, goalIdx);
  if (!cells) return null;

  // Build the lon/lat polyline. Prepend / append the original port
  // coordinates so the line starts and ends exactly at the ports
  // rather than at the snapped grid-cell centres — the short land
  // segment at each end is visually indistinguishable at normal zooms.
  const coords: [number, number][] = [[dep.lon, dep.lat]];
  for (const idx of cells) {
    const c = cellCenter(rowFromIndex(idx), colFromIndex(idx));
    coords.push([c.lon, c.lat]);
  }
  coords.push([arr.lon, arr.lat]);

  return { type: 'LineString', coordinates: coords };
}

// ---------------------------------------------------------------------------
// Constants re-exported so tests can refer to them by name
// ---------------------------------------------------------------------------

export { MASK_BYTES, MASK_COLS, MASK_ROWS, MASK_CELL_DEG, MASK_TOTAL_CELLS };
