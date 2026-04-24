/**
 * seaRouter.ts — Hybrid v2 sea-route pipeline.
 *
 * Public surface (the only thing production callers touch):
 *   - `computeSeaRoute(dep, arr)` — returns a water-only GeoJSON
 *     LineString between two real-world coords, or null when no route
 *     can be found (disconnected seas, landlocked ports).
 *
 * Test-only surface, re-exported from the historical Phase-1 A*
 * walking skeleton so existing unit tests keep working:
 *   - `loadLandMask`, `setLandMaskForTesting`
 *   - `isWater`, `findNearestWater`
 *   - `computeSeaRouteCells`
 *   - `applyCanalOverrides`
 *
 * Pipeline (ported from `tools/sea-route-lab/src/methods/hybridV2.ts`,
 * picked after a 10-method visual shoot-out documented in commit
 * 54822e0):
 *
 *   1. Adaptive fine-grained great-circle land-safety test against the
 *      0.05° raster. 0 hits → straight GC polyline (Mediterranean hops,
 *      open-ocean cruising).
 *   2. Otherwise run `searoute-ts` (Eurostat marnet graph + Dijkstra)
 *      with two guards:
 *        - endpoint-snap distance (rejects sparse-graph cases like
 *          Miami ↔ Nassau where searoute snaps 300 km inland)
 *        - known-pass whitelist (Panama / Suez / Kiel / Corinth /
 *          Bosporus / Dardanelles / Magellan) widens the snap budget
 *          because canals legitimately route via narrow corridors
 *   3. Segment-level land-run analysis on searoute output; segments
 *      with > 40 km of unbroken land crossing get replaced by a local
 *      A* detour on the 0.05° raster (budget 10 repairs).
 *   4. Whole-route 0.1° A* fallback (the original walking skeleton).
 *      Water-safe by construction; canal overrides pre-baked into the
 *      mask at load time.
 *   5. Null when every branch fails (truly landlocked ports, e.g.
 *      Moscow ↔ Barcelona).
 */

import { promises as fs } from 'fs';
import path from 'path';

import logger from '../utils/logger';
import { haversineKm, polylineLengthKm, slerp } from '../shared/geo/haversine';
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
import {
  MASK05_BYTES,
  MASK05_COLS,
  MASK05_ROWS,
  MASK05_TOTAL_CELLS,
  cellCenter05,
  cellIndex05,
  colFromIndex05,
  getBit05,
  latToRow05,
  lonToCol05,
  rowFromIndex05,
} from '../shared/geo/landMaskGrid05';
import { CANAL_OVERRIDES, type CanalOverride } from './seaCanals';

const DEFAULT_MASK_PATH = path.resolve(__dirname, '..', '..', 'data', 'land-mask-0.1deg.bin');
const DEFAULT_FINE_MASK_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'data',
  'land-mask-0.05deg.bin',
);

/** Hard cap on cells pulled from the A* heap. 6.48 M cells at 0.1°
 * can be visited worst-case; heuristic usually keeps us below 200 k. */
const MAX_A_STAR_VISITED = 2_000_000;

/** Same cap for 0.05° local-repair A*. Total cells = 25.9 M, but local
 * repair only spans short segments so actual visited is always tiny. */
const MAX_FINE_A_STAR_VISITED = 400_000;

/** 8-neighbour step table. Cost per step scales with haversine at
 * runtime — we only keep the dr/dc direction here. */
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
// 0.1° land-mask state  (Phase-1 A* walking skeleton — now the Hybrid v2
// last-resort whole-route fallback, plus the test harness surface)
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
 * tests get the same canal-patched view production uses. Pass
 * `{ skipCanals: true }` when testing the raster itself without canal
 * modifications.
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
    throw new Error(`Test mask has ${bytes.byteLength} bytes, expected ${MASK_BYTES}`);
  }
  const patched = options.skipCanals ? bytes : applyCanalOverrides(bytes);
  maskState = { bytes: patched, sourcePath: '<in-memory>' };
  loadPromise = null;
}

/**
 * Lazy-load the 0.1° packed land mask. First call reads the file; later
 * calls return the cached bytes. Rejects with a helpful message when
 * the binary is missing.
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
// Canal / strait overrides — applied once at mask-load time so every
// subsequent isWater / A* lookup is O(1).
// ---------------------------------------------------------------------------

export function applyCanalOverrides(rawBytes: Uint8Array): Uint8Array {
  const patched = new Uint8Array(rawBytes.byteLength);
  patched.set(rawBytes);
  for (const canal of CANAL_OVERRIDES) {
    paintCanalAxis(patched, canal);
  }
  return patched;
}

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
      const c = (((col + dc) % MASK_COLS) + MASK_COLS) % MASK_COLS;
      setBit(bytes, cellIndex(r, c), 0);
    }
  }
}

// ---------------------------------------------------------------------------
// 0.1° cell-level primitives
// ---------------------------------------------------------------------------

function cellIsWater(bytes: Uint8Array, row: number, col: number): boolean {
  if (row < 0 || row >= MASK_ROWS) return false;
  const c = ((col % MASK_COLS) + MASK_COLS) % MASK_COLS;
  return getBit(bytes, cellIndex(row, c)) === 0;
}

export function isWater(lat: number, lon: number): boolean {
  if (maskState === null) {
    throw new Error('Land mask not loaded — call loadLandMask() first');
  }
  const row = latToRow(lat);
  const col = lonToCol(lon);
  return cellIsWater(maskState.bytes, row, col);
}

/**
 * BFS outward from the port's cell until we find a water cell. Budget
 * is on cells visited, not km — 5000 ≈ 40-cell radius ≈ 440 km at the
 * equator. Enough for Hamburg / Antwerp / other inland river ports,
 * small enough that truly landlocked coords fail fast.
 */
export function findNearestWater(
  lat: number,
  lon: number,
  maxCells = 5000,
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
      const nc = (((col + dc) % MASK_COLS) + MASK_COLS) % MASK_COLS;
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
// 0.1° A* — used as the whole-route last-resort fallback AND as the
// synthetic test surface.
// ---------------------------------------------------------------------------

interface AStarNode {
  index: number;
  f: number; // g + h
}

function cellDistanceKm(aIdx: number, bIdx: number): number {
  const a = cellCenter(rowFromIndex(aIdx), colFromIndex(aIdx));
  const b = cellCenter(rowFromIndex(bIdx), colFromIndex(bIdx));
  return haversineKm(a, b);
}

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
  readonly maxVisited?: number;
}

/**
 * Raw A* between two 0.1°-mask cell indices. Separated from the
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

  const startRow = rowFromIndex(startIdx);
  const startCol = colFromIndex(startIdx);
  const goalRow = rowFromIndex(goalIdx);
  const goalCol = colFromIndex(goalIdx);
  if (!cellIsWater(bytes, startRow, startCol)) return null;
  if (!cellIsWater(bytes, goalRow, goalCol)) return null;

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
      const nc = (((curCol + dc) % MASK_COLS) + MASK_COLS) % MASK_COLS;
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

// ---------------------------------------------------------------------------
// 0.05° fine land-mask state — used for the GC-safety test, segment
// land-run analysis, and local A* repair of searoute output. NOT
// canal-patched; the canal transits are expected to come out of
// searoute-ts's marnet graph in step 2 of the pipeline.
// ---------------------------------------------------------------------------

let fineMaskBytes: Uint8Array | null = null;
let fineLoadPromise: Promise<Uint8Array> | null = null;

async function loadFineLandMask(): Promise<Uint8Array> {
  if (fineMaskBytes !== null) return fineMaskBytes;
  if (fineLoadPromise === null) {
    fineLoadPromise = (async (): Promise<Uint8Array> => {
      const buf = await fs.readFile(DEFAULT_FINE_MASK_PATH);
      if (buf.byteLength !== MASK05_BYTES) {
        throw new Error(
          `Fine land-mask at ${DEFAULT_FINE_MASK_PATH} has ${buf.byteLength} bytes, expected ${MASK05_BYTES}`,
        );
      }
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      fineMaskBytes = bytes;
      logger.info({
        operation: 'sea_router_fine_mask_loaded',
        path: DEFAULT_FINE_MASK_PATH,
        bytes: buf.byteLength,
      });
      return bytes;
    })().catch((err) => {
      fineLoadPromise = null;
      throw err;
    });
  }
  return fineLoadPromise;
}

function fineCellIsWater(bytes: Uint8Array, row: number, col: number): boolean {
  if (row < 0 || row >= MASK05_ROWS) return false;
  const c = ((col % MASK05_COLS) + MASK05_COLS) % MASK05_COLS;
  return getBit05(bytes, cellIndex05(row, c)) === 0;
}

function findNearestFineWater(
  bytes: Uint8Array,
  lat: number,
  lon: number,
  maxCells = 5000,
): { row: number; col: number } | null {
  const startRow = latToRow05(lat);
  const startCol = lonToCol05(lon);
  if (fineCellIsWater(bytes, startRow, startCol)) return { row: startRow, col: startCol };

  const visited = new Uint8Array(MASK05_TOTAL_CELLS);
  const queue: number[] = [cellIndex05(startRow, startCol)];
  visited[queue[0]] = 1;

  let explored = 0;
  let head = 0;
  while (head < queue.length && explored < maxCells) {
    const idx = queue[head++];
    const row = rowFromIndex05(idx);
    const col = colFromIndex05(idx);
    explored++;

    for (const [dr, dc] of NEIGHBOUR_STEPS) {
      const nr = row + dr;
      if (nr < 0 || nr >= MASK05_ROWS) continue;
      const nc = (((col + dc) % MASK05_COLS) + MASK05_COLS) % MASK05_COLS;
      const nIdx = cellIndex05(nr, nc);
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      if (fineCellIsWater(bytes, nr, nc)) return { row: nr, col: nc };
      queue.push(nIdx);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 0.05° A* — used only for localised segment repairs. Returns a short
// polyline of {lat, lon} cell centres, or null if unreachable within
// the visit budget.
// ---------------------------------------------------------------------------

function fineCellDistanceKm(aIdx: number, bIdx: number): number {
  const a = cellCenter05(rowFromIndex05(aIdx), colFromIndex05(aIdx));
  const b = cellCenter05(rowFromIndex05(bIdx), colFromIndex05(bIdx));
  return haversineKm(a, b);
}

/**
 * A* over the 0.05° mask for a SHORT segment. Unlike `computeSeaRouteCells`,
 * this one snaps the endpoints internally, operates on Maps instead of
 * whole-globe TypedArrays (N = 25.9 M is too much to allocate per request),
 * and returns the {lat, lon} path directly.
 */
function fineAStarBetween(
  bytes: Uint8Array,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): { lat: number; lon: number }[] | null {
  const startSnap = findNearestFineWater(bytes, from.lat, from.lon);
  const goalSnap = findNearestFineWater(bytes, to.lat, to.lon);
  if (!startSnap || !goalSnap) return null;

  const startIdx = cellIndex05(startSnap.row, startSnap.col);
  const goalIdx = cellIndex05(goalSnap.row, goalSnap.col);
  if (startIdx === goalIdx) return [cellCenter05(startSnap.row, startSnap.col)];

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  gScore.set(startIdx, 0);
  const closed = new Set<number>();
  const open = new BinaryHeap<AStarNode>((n) => n.f);
  open.push({ index: startIdx, f: fineCellDistanceKm(startIdx, goalIdx) });

  let visited = 0;
  while (open.size > 0 && visited < MAX_FINE_A_STAR_VISITED) {
    const current = open.pop() as AStarNode;
    const curIdx = current.index;
    if (closed.has(curIdx)) continue;
    closed.add(curIdx);
    visited++;

    if (curIdx === goalIdx) {
      const path: { lat: number; lon: number }[] = [];
      let cursor: number | undefined = goalIdx;
      while (cursor !== undefined) {
        path.unshift(cellCenter05(rowFromIndex05(cursor), colFromIndex05(cursor)));
        cursor = cameFrom.get(cursor);
      }
      return path;
    }

    const curRow = rowFromIndex05(curIdx);
    const curCol = colFromIndex05(curIdx);
    const curG = gScore.get(curIdx) ?? Infinity;

    for (const [dr, dc] of NEIGHBOUR_STEPS) {
      const nr = curRow + dr;
      if (nr < 0 || nr >= MASK05_ROWS) continue;
      const nc = (((curCol + dc) % MASK05_COLS) + MASK05_COLS) % MASK05_COLS;
      if (!fineCellIsWater(bytes, nr, nc)) continue;
      const nIdx = cellIndex05(nr, nc);
      if (closed.has(nIdx)) continue;
      const stepKm = fineCellDistanceKm(curIdx, nIdx);
      const tentative = curG + stepKm;
      const prev = gScore.get(nIdx);
      if (prev !== undefined && tentative >= prev) continue;
      gScore.set(nIdx, tentative);
      cameFrom.set(nIdx, curIdx);
      open.push({ index: nIdx, f: tentative + fineCellDistanceKm(nIdx, goalIdx) });
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Hybrid v2 primitives: GC safety test, segment land-run analysis,
// local repair, endpoint-snap guard, known-pass whitelist.
// ---------------------------------------------------------------------------

interface KnownPass {
  id: string;
  /** [minLon, minLat, maxLon, maxLat] — relaxes the endpoint-snap budget
   * when either port lies inside one of these boxes. */
  bbox: readonly [number, number, number, number];
}

const KNOWN_PASSES: readonly KnownPass[] = [
  { id: 'panama', bbox: [-80.2, 8.8, -79.4, 9.4] },
  { id: 'suez-north', bbox: [32.1, 31.0, 32.6, 31.3] },
  { id: 'suez-south', bbox: [32.3, 29.8, 32.7, 30.1] },
  { id: 'kiel-east', bbox: [10.0, 54.3, 10.3, 54.4] },
  { id: 'kiel-west', bbox: [9.0, 53.85, 9.3, 53.95] },
  { id: 'corinth', bbox: [22.8, 37.9, 23.1, 38.1] },
  { id: 'bosporus', bbox: [28.9, 41.0, 29.1, 41.3] },
  { id: 'dardanelles', bbox: [26.1, 40.0, 26.7, 40.5] },
  { id: 'magellan-west', bbox: [-74.5, -53.5, -73.5, -52.8] },
  { id: 'magellan-east', bbox: [-70.5, -52.8, -69.5, -52.2] },
];

function portInKnownPass(p: { lat: number; lon: number }): boolean {
  for (const kp of KNOWN_PASSES) {
    const [minLon, minLat, maxLon, maxLat] = kp.bbox;
    if (p.lon >= minLon && p.lon <= maxLon && p.lat >= minLat && p.lat <= maxLat) return true;
  }
  return false;
}

/**
 * Count great-circle samples that land on a land cell of the fine 0.05°
 * mask. Port endpoints themselves are skipped — harbours often sit on
 * cells the raster calls land even though water is right there.
 */
async function fineGCLandHits(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): Promise<{ hits: number; samples: number }> {
  const bytes = await loadFineLandMask();
  const chordKm = haversineKm(a, b);
  const samples = Math.max(50, Math.min(1500, Math.round(chordKm / 2)));
  let hits = 0;
  for (let i = 1; i < samples; i++) {
    const p = slerp(a, b, i / samples);
    const row = latToRow05(p.lat);
    const col = lonToCol05(p.lon);
    if (!fineCellIsWater(bytes, row, col)) hits++;
  }
  return { hits, samples };
}

/**
 * Walk each polyline segment at ~2 km slerp spacing and report the
 * longest run of consecutive land samples. Segments with long runs are
 * candidates for local A* repair; scattered coastal grazing is
 * tolerated because harbour approaches routinely register as land.
 */
async function segmentLandRuns(
  coords: ReadonlyArray<{ lat: number; lon: number }>,
): Promise<Array<{ maxRun: number }>> {
  const bytes = await loadFineLandMask();
  const out: Array<{ maxRun: number }> = [];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const segKm = haversineKm(a, b);
    const segSamples = Math.max(2, Math.min(400, Math.round(segKm / 2)));
    const startJ = i === 1 ? 1 : 0;
    const endJ = i === coords.length - 1 ? segSamples - 1 : segSamples;
    let maxRun = 0;
    let curRun = 0;
    for (let j = startJ; j < endJ; j++) {
      const p = slerp(a, b, j / segSamples);
      const row = latToRow05(p.lat);
      const col = lonToCol05(p.lon);
      if (!fineCellIsWater(bytes, row, col)) {
        curRun++;
        if (curRun > maxRun) maxRun = curRun;
      } else {
        curRun = 0;
      }
    }
    out.push({ maxRun });
  }
  return out;
}

/** 20 samples at ~2 km spacing → ~40 km unbroken land = graph gap, not
 * port-cell noise. Shorter runs are tolerated. */
const REPAIR_RUN_THRESHOLD = 20;
const REPAIR_BUDGET = 10;

/**
 * Stitch local 0.05° A* detours into a searoute polyline wherever a
 * segment clips land for > REPAIR_RUN_THRESHOLD samples. Returns:
 *   - repaired = 0  → polyline is already good, return unchanged
 *   - repaired > 0  → local repairs applied, return stitched result
 *   - repaired = -1 → too many bad segments, give up and signal caller
 *                     to fall through to the whole-route A* fallback
 */
async function localRepairAcrossLand(
  coords: ReadonlyArray<{ lat: number; lon: number }>,
): Promise<{
  coords: { lat: number; lon: number }[];
  repaired: number;
  unresolved: number;
}> {
  const runs = await segmentLandRuns(coords);
  const bad: number[] = [];
  for (let i = 0; i < runs.length; i++) {
    if (runs[i].maxRun >= REPAIR_RUN_THRESHOLD) bad.push(i);
  }
  if (bad.length === 0) return { coords: [...coords], repaired: 0, unresolved: 0 };
  if (bad.length > REPAIR_BUDGET) {
    return { coords: [...coords], repaired: -1, unresolved: bad.length };
  }

  const bytes = await loadFineLandMask();
  const repairIdx = new Set(bad);
  const out: { lat: number; lon: number }[] = [coords[0]];
  let resolved = 0;
  let unresolved = 0;
  for (let i = 1; i < coords.length; i++) {
    if (repairIdx.has(i - 1)) {
      const detour = fineAStarBetween(bytes, coords[i - 1], coords[i]);
      if (detour && detour.length > 2) {
        // Detour starts near coords[i-1] (already in out) — skip to avoid dupe.
        for (let k = 1; k < detour.length; k++) out.push(detour[k]);
        resolved++;
        continue;
      }
      // A* couldn't repair; the original bad segment stays in the output.
      // Report it so the caller can fall through to whole-route A*.
      unresolved++;
    }
    out.push(coords[i]);
  }
  return { coords: out, repaired: resolved, unresolved };
}

interface EndpointSnapResult {
  readonly bad: boolean;
  readonly reason?: string;
}

/**
 * Endpoint-snap check: if searoute's first / last vertex is farther
 * from the raw port than the sparseness budget, searoute's graph has
 * a gap near that port (classic Miami ↔ Nassau failure). Known-pass
 * ports get a wider budget because canal transits legitimately snap
 * far from the harbour.
 */
function endpointSnapBad(
  route: ReadonlyArray<{ lat: number; lon: number }>,
  dep: { lat: number; lon: number },
  arr: { lat: number; lon: number },
  chordKm: number,
): EndpointSnapResult {
  const localBudget = Math.max(25, 0.15 * chordKm);
  const wideBudget = Math.max(200, 0.4 * chordKm);
  const fromBudget = portInKnownPass(dep) ? wideBudget : localBudget;
  const toBudget = portInKnownPass(arr) ? wideBudget : localBudget;

  const firstSnap = haversineKm(dep, route[0]);
  if (firstSnap > fromBudget) {
    return {
      bad: true,
      reason: `origin snap ${firstSnap.toFixed(0)} km > ${fromBudget.toFixed(0)} km budget`,
    };
  }
  const lastSnap = haversineKm(arr, route[route.length - 1]);
  if (lastSnap > toBudget) {
    return {
      bad: true,
      reason: `dest snap ${lastSnap.toFixed(0)} km > ${toBudget.toFixed(0)} km budget`,
    };
  }
  return { bad: false };
}

// ---------------------------------------------------------------------------
// searoute-ts wrapper — contains the typing boundary (lib is loosely
// typed, its origin / destination parameters are declared `any`).
// ---------------------------------------------------------------------------

interface SearouteFeature {
  readonly type: 'Feature';
  readonly properties: Record<string, unknown>;
  readonly geometry: { readonly type: 'Point'; readonly coordinates: readonly [number, number] };
}

function buildPointFeature(lon: number, lat: number): SearouteFeature {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [lon, lat] },
  };
}

/**
 * searoute-ts is shipped as ESM with loose types; Jest+ts-jest can't
 * load it through a static import without a transformIgnorePatterns
 * rabbit-hole across the @turf dependency tree. Lazy-require under a
 * small wrapper keeps test isolation trivial: `setSearouteForTesting`
 * injects a stub and the real module is never loaded during unit runs.
 */
type SearouteRunner = (
  origin: SearouteFeature,
  destination: SearouteFeature,
  units: 'kilometers',
) => { geometry: { coordinates: unknown }; properties?: Record<string, unknown> };

let cachedSearoute: SearouteRunner | null = null;

function loadSearoute(): SearouteRunner {
  if (cachedSearoute !== null) return cachedSearoute;
  const mod = require('searoute-ts') as { seaRoute: SearouteRunner };
  cachedSearoute = mod.seaRoute;
  return cachedSearoute;
}

/** Tests-only: inject a stub searoute implementation (or null to revert). */
export function setSearouteForTesting(runner: SearouteRunner | null): void {
  cachedSearoute = runner;
}

function runSearoute(
  dep: { lat: number; lon: number },
  arr: { lat: number; lon: number },
): { coords: { lat: number; lon: number }[]; km: number } | null {
  try {
    const origin = buildPointFeature(dep.lon, dep.lat);
    const destination = buildPointFeature(arr.lon, arr.lat);
    const feature = loadSearoute()(origin, destination, 'kilometers');
    const raw = feature.geometry?.coordinates;
    if (!Array.isArray(raw)) return null;
    const coords: { lat: number; lon: number }[] = [];
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 2) return null;
      const lon = entry[0];
      const lat = entry[1];
      if (typeof lon !== 'number' || typeof lat !== 'number') return null;
      coords.push({ lat, lon });
    }
    if (coords.length < 2) return null;
    const lengthProp = feature.properties?.length;
    const km = typeof lengthProp === 'number' && lengthProp > 0 ? lengthProp : polylineLengthKm(coords);
    if (km <= 0) return null;
    return { coords, km };
  } catch (err) {
    logger.warn({ operation: 'searoute_threw', error: err instanceof Error ? err.message : err });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SeaRoutePoint {
  readonly lat: number;
  readonly lon: number;
}

export interface SeaRouteLineString {
  readonly type: 'LineString';
  readonly coordinates: [number, number][];
}

export type RouteQuality = 'good' | 'schematic';

export interface RouteQualityResult {
  readonly quality: RouteQuality;
  readonly landRatio: number;
}

/**
 * Flag a computed sea-route as `schematic` when ≥ 25 % of its interior
 * vertices land on non-water cells of the 0.1° mask. The frontend uses
 * this flag to fall back to a dashed straight-line (chord) render —
 * a dishonest zig-zag over Bavaria looks like a bug, a dashed chord
 * reads as "route unknown, schematic only".
 *
 * Interior-only because river ports (Hamburg on the Elbe, Antwerp on
 * the Scheldt, Bremerhaven at the mouth of the Weser) sit ON land in
 * the 0.1° raster by default — scoring their endpoints would push
 * every short Hamburg-class leg into `schematic` even when the
 * routed polyline is fine.
 *
 * Requires the 0.1° land mask to be loaded. `computeSeaRoute` always
 * loads it on the happy path, and `cruiseRouteCache` only calls this
 * after a compute succeeds, so the throw-on-unloaded path here is
 * only reachable from a direct caller that skipped the pipeline.
 */
export const SCHEMATIC_LAND_RATIO_THRESHOLD = 0.25;

export function classifyRouteQuality(
  coords: ReadonlyArray<[number, number]>,
): RouteQualityResult {
  const interior = coords.length - 2;
  if (interior <= 0) return { quality: 'good', landRatio: 0 };

  let land = 0;
  for (let k = 1; k < coords.length - 1; k++) {
    const [lon, lat] = coords[k];
    if (!isWater(lat, lon)) land++;
  }
  const landRatio = land / interior;
  return {
    quality: landRatio >= SCHEMATIC_LAND_RATIO_THRESHOLD ? 'schematic' : 'good',
    landRatio,
  };
}

function coordsToLineString(coords: ReadonlyArray<{ lat: number; lon: number }>): SeaRouteLineString {
  const out: [number, number][] = [];
  for (const p of coords) out.push([p.lon, p.lat]);
  return { type: 'LineString', coordinates: out };
}

function greatCirclePolyline(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  samples = 64,
): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (let i = 0; i <= samples; i++) out.push(slerp(a, b, i / samples));
  return out;
}

/**
 * Whole-route 0.1° A* fallback. Snaps both endpoints to water and
 * returns a cell-centre polyline, or null when either port is too far
 * from navigable water or the seas are disconnected.
 *
 * Inland river-ports (Hamburg on the Elbe, Antwerp on the Scheldt) end
 * up with the first/last water-cell several cells inland from the raw
 * port coord; we don't prepend the raw port here — the cruise-map
 * marker renders separately and a straight over-land line would look
 * worse than the short gap.
 */
async function wholeRouteAStarFallback(
  dep: { lat: number; lon: number },
  arr: { lat: number; lon: number },
): Promise<{ lat: number; lon: number }[] | null> {
  const bytes = await loadLandMask();
  const depOnWater = cellIsWater(bytes, latToRow(dep.lat), lonToCol(dep.lon));
  const depSnap = depOnWater ? dep : findNearestWater(dep.lat, dep.lon);
  if (!depSnap) {
    logger.warn({ operation: 'sea_router_snap_failed', endpoint: 'dep', lat: dep.lat, lon: dep.lon });
    return null;
  }
  const arrOnWater = cellIsWater(bytes, latToRow(arr.lat), lonToCol(arr.lon));
  const arrSnap = arrOnWater ? arr : findNearestWater(arr.lat, arr.lon);
  if (!arrSnap) {
    logger.warn({ operation: 'sea_router_snap_failed', endpoint: 'arr', lat: arr.lat, lon: arr.lon });
    return null;
  }

  const startIdx = cellIndex(latToRow(depSnap.lat), lonToCol(depSnap.lon));
  const goalIdx = cellIndex(latToRow(arrSnap.lat), lonToCol(arrSnap.lon));
  const cells = computeSeaRouteCells(bytes, startIdx, goalIdx);
  if (!cells) return null;

  const out: { lat: number; lon: number }[] = [];
  if (depOnWater) out.push(dep);
  for (const idx of cells) out.push(cellCenter(rowFromIndex(idx), colFromIndex(idx)));
  if (arrOnWater) out.push(arr);
  return out;
}

/**
 * Hybrid v2 entry point — see file header for the full pipeline
 * description. Returns a GeoJSON LineString in `[lon, lat]` vertex
 * order, or null when every branch fails.
 */
export async function computeSeaRoute(
  dep: SeaRoutePoint,
  arr: SeaRoutePoint,
): Promise<SeaRouteLineString | null> {
  const t0 = Date.now();
  const chordKm = haversineKm(dep, arr);

  // 1. Fine GC-safety test on the 0.05° mask.
  try {
    const gc = await fineGCLandHits(dep, arr);
    if (gc.hits === 0) {
      const coords = greatCirclePolyline(dep, arr, 64);
      logger.debug({
        operation: 'sea_router_hybrid_gc',
        chordKm: Math.round(chordKm),
        samples: gc.samples,
        durationMs: Date.now() - t0,
      });
      return coordsToLineString(coords);
    }
  } catch (err) {
    logger.warn({
      operation: 'sea_router_fine_mask_unavailable',
      error: err instanceof Error ? err.message : err,
    });
    // Skip the fine-mask branches entirely; fall straight to 0.1° A*.
    const fallback = await wholeRouteAStarFallback(dep, arr);
    return fallback === null ? null : coordsToLineString(fallback);
  }

  // 2. searoute-ts + endpoint-snap guard + local repair.
  const sr = runSearoute(dep, arr);
  let rejectReason: string | null = null;
  if (sr) {
    const snap = endpointSnapBad(sr.coords, dep, arr, chordKm);
    if (snap.bad) {
      rejectReason = snap.reason ?? 'endpoint snap';
    } else {
      const repair = await localRepairAcrossLand(sr.coords);
      if (repair.repaired === 0 && repair.unresolved === 0) {
        logger.info({
          operation: 'sea_router_hybrid_searoute',
          chordKm: Math.round(chordKm),
          km: Math.round(sr.km),
          durationMs: Date.now() - t0,
        });
        return coordsToLineString(sr.coords);
      }
      if (repair.repaired > 0 && repair.unresolved === 0) {
        logger.info({
          operation: 'sea_router_hybrid_searoute_repaired',
          chordKm: Math.round(chordKm),
          repaired: repair.repaired,
          km: Math.round(polylineLengthKm(repair.coords)),
          durationMs: Date.now() - t0,
        });
        return coordsToLineString(repair.coords);
      }
      rejectReason =
        `searoute too broken (${bad(repair.repaired)} repaired, ` +
        `${repair.unresolved} unresolved gap-segments)`;
    }
  } else {
    rejectReason = 'searoute returned null';
  }

  // 3. Whole-route 0.1° A* fallback. Water-safe by construction.
  const fallback = await wholeRouteAStarFallback(dep, arr);
  if (fallback !== null) {
    logger.info({
      operation: 'sea_router_hybrid_fallback_astar',
      chordKm: Math.round(chordKm),
      rejectReason,
      km: Math.round(polylineLengthKm(fallback)),
      durationMs: Date.now() - t0,
    });
    return coordsToLineString(fallback);
  }

  logger.warn({
    operation: 'sea_router_hybrid_all_failed',
    chordKm: Math.round(chordKm),
    rejectReason,
    durationMs: Date.now() - t0,
  });
  return null;
}

function bad(repaired: number): string {
  return repaired < 0 ? `>${REPAIR_BUDGET}` : String(repaired);
}

// ---------------------------------------------------------------------------
// Constants re-exported so tests can refer to them by name
// ---------------------------------------------------------------------------

export { MASK_BYTES, MASK_COLS, MASK_ROWS, MASK_CELL_DEG, MASK_TOTAL_CELLS };
