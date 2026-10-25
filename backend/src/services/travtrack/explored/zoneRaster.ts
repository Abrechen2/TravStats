/**
 * The explored map's zone rule, pure (TravTrack plan L1; Codex and security
 * review of a3353f2a7): the tiles a privacy circle touches, their
 * edge-connected components, and which cells of a component are drawn.
 *
 * A zone cell is decided by its SURROUNDINGS, never by the circle — filling
 * the whole circle once anything touched it drew its footprint, and leaving
 * it empty drew a hole. A cell explored itself is drawn. Any other cell looks
 * along each of its four directions through the component to the first cell
 * outside it (or the first explored one): when at least three of the four
 * reach explored ground it is drawn. Then, to a fixed point, a cell with at
 * least three edge neighbours explored or drawn is drawn too.
 *
 * Linear in the component's size: the four directions are one pass per row
 * and per column each way, the fixed point a worklist. Columns wrap at the
 * date line; a component across it is processed with its columns shifted by
 * half the grid, so no row needs to wrap.
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

/** The share of a cell's four directions that must reach explored ground. */
const CLOSED_OF_FOUR = 3;

/** Per line of cells, sorted: whether each one's ray forward reaches explored ground. */
function sweep(
  line: readonly number[],
  coord: (i: number) => Cell,
  explored: (c: Cell) => boolean,
  dir: 1 | -1,
  out: Map<string, number>
): void {
  // `line` holds the positions along the line in order of travel.
  let closed = false;
  for (let i = 0; i < line.length; i++) {
    const here = line[i];
    const prev = i === 0 ? null : line[i - 1];
    // A new run starts where the previous position is not the next one: its
    // stop is the cell just before it, outside the component.
    if (prev === null || here !== prev + dir) closed = explored(coord(here - dir));
    const cell = coord(here);
    const k = cellKey(cell);
    if (closed) out.set(k, (out.get(k) ?? 0) + 1);
    // An explored zone cell stops every ray behind it.
    if (explored(cell)) closed = true;
  }
}

/**
 * Which cells of one component are drawn (see the file comment). `explored`
 * must name every explored cell in the component and on its edges.
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
  const rows = new Map<number, number[]>();
  const cols = new Map<number, number[]>();
  const add = (m: Map<number, number[]>, at: number, v: number) => {
    const list = m.get(at);
    if (list) list.push(v);
    else m.set(at, [v]);
  };
  for (const c of cells) {
    add(rows, c.y, c.x);
    add(cols, c.x, c.y);
  }
  const closedRays = new Map<string, number>();
  for (const [y, line] of rows) {
    const sorted = [...line].sort((a, b) => a - b);
    const at = (x: number): Cell => ({ x, y });
    sweep(sorted, at, isExplored, 1, closedRays);
    sweep([...sorted].reverse(), at, isExplored, -1, closedRays);
  }
  for (const [x, line] of cols) {
    const sorted = [...line].sort((a, b) => a - b);
    const at = (y: number): Cell => ({ x, y });
    sweep(sorted, at, isExplored, 1, closedRays);
    sweep([...sorted].reverse(), at, isExplored, -1, closedRays);
  }

  const drawn = new Set<string>();
  for (const c of cells) {
    const k = cellKey(c);
    if (isExplored(c) || (closedRays.get(k) ?? 0) >= CLOSED_OF_FOUR) drawn.add(k);
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
