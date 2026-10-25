/**
 * The explored map's zone rule, pure (TravTrack plan L1; Codex and security
 * review of a3353f2a7): the tiles a privacy circle touches, their
 * edge-connected components, and which cells of a component are drawn.
 *
 * A zone cell is decided by its SURROUNDINGS, never by the circle — filling
 * the whole circle once anything touched it drew its footprint, and leaving
 * it empty drew a hole. A cell explored itself is drawn. Any other cell looks
 * along eight directions — four orthogonal, four diagonal — through the
 * component to the first cell outside it (or the first explored one). It is
 * drawn when both rays of an opposite pair (W–E, N–S, NW–SE, SW–NE) reach
 * explored ground, so a road through a zone runs on through it (Codex
 * re-review), or when three of the four orthogonal rays do. Then, to a fixed
 * point, a cell with at least three edge neighbours explored or drawn is
 * drawn too.
 *
 * Linear in the component's size: each direction is one pass per line of its
 * family (rows, columns, both diagonals) each way, the fixed point a
 * worklist. Columns wrap at the date line; a component across it is processed
 * with its columns shifted by half the grid, so no line needs to wrap.
 */
import { distanceM, type ZoneCircle } from "../classify";
import { cellKey, TILES, tileBounds, tileOf, type Cell } from "./cells";

const M_PER_DEG_LAT = 111_320;

export const wrapX = (x: number): number => ((x % TILES) + TILES) % TILES;
const lonTile = (lon: number) => Math.floor(((lon + 180) / 360) * TILES);

/**
 * The tiles a circle touches (its closest point inside the tile is within the
 * radius). A circle across the date line is split: its columns wrap round.
 */
export function circleCells(circle: ZoneCircle): Cell[] {
  const dLat = circle.radiusM / M_PER_DEG_LAT;
  const dLon = dLat / Math.max(0.01, Math.cos((circle.lat * Math.PI) / 180));
  const yMin = tileOf(circle.lat + dLat, circle.lon).y;
  const yMax = tileOf(circle.lat - dLat, circle.lon).y;
  const out = new Map<string, Cell>();
  // Unwrapped columns: a tile beyond ±180 is measured where it lies (the
  // haversine reads longitude round the sphere) and stored wrapped.
  for (let ux = lonTile(circle.lon - dLon); ux <= lonTile(circle.lon + dLon); ux++) {
    for (let y = yMin; y <= yMax; y++) {
      const b = tileBounds({ x: ux, y });
      const nearest = {
        lat: Math.min(b.north, Math.max(b.south, circle.lat)),
        lon: Math.min(b.east, Math.max(b.west, circle.lon)),
      };
      if (distanceM(circle, nearest) <= circle.radiusM) {
        const cell = { x: wrapX(ux), y };
        out.set(cellKey(cell), cell);
      }
    }
  }
  return [...out.values()];
}

const EDGES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const step = (c: Cell, [dx, dy]: readonly [number, number]): Cell | null => {
  const y = c.y + dy;
  return y < 0 || y >= TILES ? null : { x: wrapX(c.x + dx), y };
};

/** Edge-connected components (columns wrap). Linear: a flood fill over a key set. */
export function zoneComponents(cells: Iterable<Cell>): Cell[][] {
  const all = new Map<string, Cell>();
  for (const c of cells) all.set(cellKey(c), c);
  const seen = new Set<string>();
  const components: Cell[][] = [];
  for (const [startKey, start] of all) {
    if (seen.has(startKey)) continue;
    seen.add(startKey);
    const component: Cell[] = [];
    const queue = [start];
    while (queue.length > 0) {
      const c = queue.pop()!;
      component.push(c);
      for (const edge of EDGES) {
        const n = step(c, edge);
        const k = n && cellKey(n);
        if (n && k && all.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push(all.get(k)!);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** The share of a cell's four orthogonal directions that must reach explored ground. */
const CLOSED_OF_FOUR = 3;

/** Ray bits: the direction each ray looks in. */
const W = 1;
const E = 2;
const N = 4;
const S = 8;
const NW = 16;
const SE = 32;
const SW = 64;
const NE = 128;
const OPPOSITE_PAIRS = [W | E, N | S, NW | SE, SW | NE];
const ORTHOGONAL = [W, E, N, S];

/**
 * A family of parallel lines through the grid: rows, columns, or one of the
 * two diagonals. `line`/`pos` place a cell on it; `at` is the inverse. The
 * sweep in ascending `pos` order sets `back` (the ray looking towards lower
 * `pos`), the descending one `ahead`.
 */
type LineFamily = {
  line: (c: Cell) => number;
  pos: (c: Cell) => number;
  at: (line: number, pos: number) => Cell;
  back: number;
  ahead: number;
};

const FAMILIES: LineFamily[] = [
  { line: (c) => c.y, pos: (c) => c.x, at: (l, p) => ({ x: p, y: l }), back: W, ahead: E },
  // y grows southwards: looking to lower y is looking north.
  { line: (c) => c.x, pos: (c) => c.y, at: (l, p) => ({ x: l, y: p }), back: N, ahead: S },
  // Steps of (1, 1): lower x is north-west.
  {
    line: (c) => c.x - c.y,
    pos: (c) => c.x,
    at: (l, p) => ({ x: p, y: p - l }),
    back: NW,
    ahead: SE,
  },
  // Steps of (1, -1): lower x is south-west.
  {
    line: (c) => c.x + c.y,
    pos: (c) => c.x,
    at: (l, p) => ({ x: p, y: l - p }),
    back: SW,
    ahead: NE,
  },
];

/**
 * One pass along a line of cells in travel order: the ray looking back
 * reaches explored ground when the nearest stop behind it is explored — the
 * cell just outside the run, or an explored cell of the run itself.
 */
function sweep(
  positions: readonly number[],
  at: (pos: number) => Cell,
  explored: (c: Cell) => boolean,
  dir: 1 | -1,
  bit: number,
  rays: Map<string, number>
): void {
  let closed = false;
  for (let i = 0; i < positions.length; i++) {
    const here = positions[i];
    if (i === 0 || here !== positions[i - 1] + dir) closed = explored(at(here - dir));
    const cell = at(here);
    if (closed) {
      const k = cellKey(cell);
      rays.set(k, (rays.get(k) ?? 0) | bit);
    }
    if (explored(cell)) closed = true;
  }
}

/** Whether a cell's rays close it: an opposite pair both, or three of the four orthogonal ones. */
const closedByRays = (bits: number): boolean =>
  OPPOSITE_PAIRS.some((pair) => (bits & pair) === pair) ||
  ORTHOGONAL.filter((b) => (bits & b) !== 0).length >= CLOSED_OF_FOUR;

/**
 * Which cells of one component are drawn (see the file comment). `explored`
 * must name every explored cell in the component and on its edges, corners
 * included.
 */
export function fillComponent(component: readonly Cell[], explored: ReadonlySet<string>): Cell[] {
  if (component.length === 0) return [];
  // Across the date line: work in columns shifted by half the grid.
  const xs = new Set(component.map((c) => c.x));
  const shift = xs.has(0) && xs.has(TILES - 1) ? TILES / 2 : 0;
  const local = (c: Cell): Cell => ({ x: wrapX(c.x + shift), y: c.y });
  const global = (c: Cell): Cell => ({ x: wrapX(c.x - shift), y: c.y });
  const isExplored = (c: Cell) => c.y >= 0 && c.y < TILES && explored.has(cellKey(global(c)));

  const cells = component.map(local);
  const inside = new Set(cells.map(cellKey));
  const rays = new Map<string, number>();
  for (const family of FAMILIES) {
    const lines = new Map<number, number[]>();
    for (const c of cells) {
      const l = family.line(c);
      const list = lines.get(l);
      if (list) list.push(family.pos(c));
      else lines.set(l, [family.pos(c)]);
    }
    for (const [l, positions] of lines) {
      const sorted = [...positions].sort((a, b) => a - b);
      const at = (p: number) => family.at(l, p);
      sweep(sorted, at, isExplored, 1, family.back, rays);
      sweep(sorted.reverse(), at, isExplored, -1, family.ahead, rays);
    }
  }

  const drawn = new Set<string>();
  for (const c of cells) {
    const k = cellKey(c);
    if (isExplored(c) || closedByRays(rays.get(k) ?? 0)) drawn.add(k);
  }
  // The fixed point, as a worklist: a cell is looked at again only when a
  // neighbour of it was just drawn.
  const neighbours = (c: Cell) => EDGES.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy }));
  const closedCount = (c: Cell) =>
    neighbours(c).filter((n) => isExplored(n) || drawn.has(cellKey(n))).length;
  const queue = cells.filter((c) => !drawn.has(cellKey(c)));
  while (queue.length > 0) {
    const c = queue.pop()!;
    const k = cellKey(c);
    if (drawn.has(k) || closedCount(c) < CLOSED_OF_FOUR) continue;
    drawn.add(k);
    for (const n of neighbours(c)) {
      if (inside.has(cellKey(n)) && !drawn.has(cellKey(n))) queue.push(n);
    }
  }
  return cells.filter((c) => drawn.has(cellKey(c))).map(global);
}
