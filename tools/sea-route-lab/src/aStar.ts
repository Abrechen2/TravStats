import type { LonLat } from "./types";
import type { LandMask } from "./landMask";
import {
  cellCenter,
  cellIndex,
  isWaterCell,
  latToRow,
  lonToCol,
} from "./landMask";
import { haversineKm } from "./geo";

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

const MAX_VISITED = 2_000_000;
const SNAP_BUDGET = 5000;

class BinaryHeap<T> {
  private heap: T[] = [];
  constructor(private readonly score: (x: T) => number) {}
  push(x: T): void {
    this.heap.push(x);
    this.siftUp(this.heap.length - 1);
  }
  pop(): T | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last !== undefined) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }
  get size(): number {
    return this.heap.length;
  }
  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.score(this.heap[i]) < this.score(this.heap[parent])) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }
  private siftDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.score(this.heap[l]) < this.score(this.heap[smallest])) smallest = l;
      if (r < n && this.score(this.heap[r]) < this.score(this.heap[smallest])) smallest = r;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

function snapToWater(lat: number, lon: number, mask: LandMask): { row: number; col: number } | null {
  const startRow = latToRow(lat, mask);
  const startCol = lonToCol(lon, mask);
  if (isWaterCell(startRow, startCol, mask)) return { row: startRow, col: startCol };
  const visited = new Uint8Array(mask.rows * mask.cols);
  const queue: Array<[number, number]> = [[startRow, startCol]];
  visited[cellIndex(startRow, startCol, mask)] = 1;
  let head = 0;
  let explored = 0;
  while (head < queue.length && explored < SNAP_BUDGET) {
    const [row, col] = queue[head++];
    explored++;
    for (const [dr, dc] of NEIGHBOURS) {
      const nr = row + dr;
      if (nr < 0 || nr >= mask.rows) continue;
      const nc = ((col + dc) % mask.cols + mask.cols) % mask.cols;
      const idx = cellIndex(nr, nc, mask);
      if (visited[idx]) continue;
      visited[idx] = 1;
      if (isWaterCell(nr, nc, mask)) return { row: nr, col: nc };
      queue.push([nr, nc]);
    }
  }
  return null;
}

/**
 * A* between two geographic coordinates over the packed land mask.
 * Returns the cell-center polyline (no raw-port prepend/append) or
 * `null` when either endpoint cannot be snapped to water or the seas
 * are disconnected.
 */
export function computeAStar(
  from: LonLat,
  to: LonLat,
  mask: LandMask,
): LonLat[] | null {
  const depSnap = snapToWater(from[1], from[0], mask);
  const arrSnap = snapToWater(to[1], to[0], mask);
  if (!depSnap || !arrSnap) return null;

  const start = cellIndex(depSnap.row, depSnap.col, mask);
  const goal = cellIndex(arrSnap.row, arrSnap.col, mask);
  if (start === goal) {
    return [cellCenter(depSnap.row, depSnap.col, mask)];
  }

  const goalCoord = cellCenter(arrSnap.row, arrSnap.col, mask);
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  gScore.set(start, 0);

  const open = new BinaryHeap<{ idx: number; f: number }>((n) => n.f);
  open.push({ idx: start, f: haversineKm(cellCenter(depSnap.row, depSnap.col, mask), goalCoord) });

  let visited = 0;
  const closed = new Uint8Array(mask.rows * mask.cols);

  while (open.size > 0 && visited < MAX_VISITED) {
    const current = open.pop();
    if (!current) break;
    if (current.idx === goal) {
      const out: LonLat[] = [];
      let cursor: number | undefined = goal;
      while (cursor !== undefined) {
        const row = Math.floor(cursor / mask.cols);
        const col = cursor - row * mask.cols;
        out.unshift(cellCenter(row, col, mask));
        cursor = cameFrom.get(cursor);
      }
      return out;
    }
    if (closed[current.idx]) continue;
    closed[current.idx] = 1;
    visited++;

    const row = Math.floor(current.idx / mask.cols);
    const col = current.idx - row * mask.cols;
    const cur = cellCenter(row, col, mask);
    const g = gScore.get(current.idx) ?? Infinity;

    for (const [dr, dc] of NEIGHBOURS) {
      const nr = row + dr;
      if (nr < 0 || nr >= mask.rows) continue;
      const nc = ((col + dc) % mask.cols + mask.cols) % mask.cols;
      if (!isWaterCell(nr, nc, mask)) continue;
      const nIdx = cellIndex(nr, nc, mask);
      if (closed[nIdx]) continue;
      const n = cellCenter(nr, nc, mask);
      const tentative = g + haversineKm(cur, n);
      const best = gScore.get(nIdx);
      if (best !== undefined && tentative >= best) continue;
      cameFrom.set(nIdx, current.idx);
      gScore.set(nIdx, tentative);
      open.push({ idx: nIdx, f: tentative + haversineKm(n, goalCoord) });
    }
  }
  return null;
}
