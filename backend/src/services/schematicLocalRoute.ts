import { haversineKm } from "../shared/geo/haversine";
import { BinaryHeap } from "../shared/geo/binaryHeap";
import {
  MASK_COLS,
  MASK_ROWS,
  cellCenter,
  cellIndex,
  getBit,
  latToRow,
  lonToCol,
} from "../shared/geo/landMaskGrid";
import { segmentAllWater, simplifyDegrees } from "./schematicPolyline";

/**
 * Fine local water path for short crossings (forgejo#428).
 *
 * The 1 degree A* and the shipping-lane graph are blind at the scale of a
 * 30 km crossing: Amalfi -> Capri came back as a 102 km loop south around the
 * island because the nearest lane nodes sit on the far side. Here A* runs on
 * the 0.025 degree land mask itself, inside a box around both ports, so the
 * path can only be as long as the water allows.
 */

/** Box padding around the two ports, in fine cells (about 28 km). */
const PAD_CELLS = 10;
/** How far a port on a land cell may be snapped to water, in fine cells. */
const SNAP_CELLS = 6;
const SIMPLIFY_TOLERANCE_DEG = 0.015;

const STEPS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

function isWaterCell(bytes: Uint8Array, row: number, col: number): boolean {
  if (row < 0 || row >= MASK_ROWS || col < 0 || col >= MASK_COLS) return false;
  return getBit(bytes, cellIndex(row, col)) === 0;
}

function snapToWater(
  bytes: Uint8Array,
  row: number,
  col: number
): { row: number; col: number } | null {
  if (isWaterCell(bytes, row, col)) return { row, col };
  for (let r = 1; r <= SNAP_CELLS; r++) {
    let best: { row: number; col: number; d: number } | null = null;
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
        if (!isWaterCell(bytes, row + dr, col + dc)) continue;
        const d = Math.hypot(dr, dc);
        if (best === null || d < best.d) best = { row: row + dr, col: col + dc, d };
      }
    }
    if (best) return { row: best.row, col: best.col };
  }
  return null;
}

/**
 * [lon, lat] waypoints from `dep` to `arr` over fine-mask water, or null when
 * the box holds no connection (the caller then keeps its own fallback). The
 * first and last points are the raw port coordinates.
 */
export function routeFineLocal(
  fineBytes: Uint8Array,
  dep: { lat: number; lon: number },
  arr: { lat: number; lon: number }
): [number, number][] | null {
  const dr0 = latToRow(dep.lat);
  const dc0 = lonToCol(dep.lon);
  const ar0 = latToRow(arr.lat);
  const ac0 = lonToCol(arr.lon);
  const minRow = Math.max(0, Math.min(dr0, ar0) - PAD_CELLS);
  const maxRow = Math.min(MASK_ROWS - 1, Math.max(dr0, ar0) + PAD_CELLS);
  const minCol = Math.max(0, Math.min(dc0, ac0) - PAD_CELLS);
  const maxCol = Math.min(MASK_COLS - 1, Math.max(dc0, ac0) + PAD_CELLS);
  const width = maxCol - minCol + 1;
  const height = maxRow - minRow + 1;

  const start = snapToWater(fineBytes, dr0, dc0);
  const goal = snapToWater(fineBytes, ar0, ac0);
  if (!start || !goal) return null;
  const inBox = (c: { row: number; col: number }) =>
    c.row >= minRow && c.row <= maxRow && c.col >= minCol && c.col <= maxCol;
  if (!inBox(start) || !inBox(goal)) return null;

  const local = (row: number, col: number) => (row - minRow) * width + (col - minCol);
  const goalCenter = cellCenter(goal.row, goal.col);
  const gScore = new Float64Array(width * height).fill(Infinity);
  const parent = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  const heap = new BinaryHeap<{ row: number; col: number; f: number }>((n) => n.f);

  gScore[local(start.row, start.col)] = 0;
  heap.push({
    ...start,
    f: haversineKm(cellCenter(start.row, start.col), goalCenter),
  });

  let found = false;
  while (heap.size > 0) {
    const cur = heap.pop()!;
    const ci = local(cur.row, cur.col);
    if (closed[ci]) continue;
    closed[ci] = 1;
    if (cur.row === goal.row && cur.col === goal.col) {
      found = true;
      break;
    }
    const here = cellCenter(cur.row, cur.col);
    for (const [dr, dc] of STEPS) {
      const nr = cur.row + dr;
      const nc = cur.col + dc;
      if (nr < minRow || nr > maxRow || nc < minCol || nc > maxCol) continue;
      if (!isWaterCell(fineBytes, nr, nc)) continue;
      // No diagonal squeeze between two land corners.
      if (dr !== 0 && dc !== 0) {
        if (
          !isWaterCell(fineBytes, cur.row + dr, cur.col) &&
          !isWaterCell(fineBytes, cur.row, cur.col + dc)
        )
          continue;
      }
      const ni = local(nr, nc);
      if (closed[ni]) continue;
      const nCenter = cellCenter(nr, nc);
      const g = gScore[ci] + haversineKm(here, nCenter);
      if (g >= gScore[ni]) continue;
      gScore[ni] = g;
      parent[ni] = ci;
      heap.push({ row: nr, col: nc, f: g + haversineKm(nCenter, goalCenter) });
    }
  }
  if (!found) return null;

  const cells: [number, number][] = [];
  for (let i = local(goal.row, goal.col); i !== -1; i = parent[i]) {
    const row = minRow + Math.floor(i / width);
    const col = minCol + (i % width);
    const c = cellCenter(row, col);
    cells.push([c.lon, c.lat]);
  }
  cells.reverse();
  const path: [number, number][] = [[dep.lon, dep.lat], ...cells, [arr.lon, arr.lat]];
  const simplified = simplifyDegrees(path, SIMPLIFY_TOLERANCE_DEG);
  // Simplification may cut a corner of land; keep the cell path when it does.
  const clean = simplified.every(
    (p, i) =>
      i === 0 || segmentAllWater(fineBytes, simplified[i - 1][0], simplified[i - 1][1], p[0], p[1])
  );
  return clean ? simplified : path;
}
