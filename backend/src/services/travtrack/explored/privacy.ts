/**
 * What the explored map shows (TravTrack plan L1, review focus 26) — one
 * output format and one privacy model:
 *
 *   - Always zoom-14 cells (`cells.ts`), never a time, never a point.
 *   - Privacy zones are shown as explored ground, never as a hole and never
 *     as a shape of their own. No point is stored inside a zone, so its cells
 *     would read as unexplored and its outline would show as a hole. Filling
 *     the whole circle once anything touched it drew the circle's footprint
 *     instead (Codex review of a3353f2a7). So a zone cell is decided by its
 *     SURROUNDINGS (`fillComponent`): drawn when three of its four directions
 *     reach explored ground, closed to a fixed point. A zone inside explored
 *     ground fills in, one at the edge of explored ground follows that edge,
 *     one beside a road or nobody's ground draws nothing. The legend says so
 *     ("Privatzonen werden als erkundet gezeigt").
 *
 * The circles are the zones in force AND every former zone's circle: points
 * inside one were deleted when it was made, so its old hole would outline it
 * just the same. Components are judged on the whole circle, never on the part
 * inside the asked box, so panning cannot change what a cell shows.
 */
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { distanceM, type ZoneCircle } from "../classify";
import { privacyCirclesFor } from "../privacyCircles";
import {
  bboxRanges,
  cellKey,
  inRanges,
  sortCells,
  TILES,
  tileBounds,
  tileOf,
  type Bbox,
  type Cell,
  type TileRange,
} from "./cells";

/** The most cells one answer carries; more → 400 `TRAVTRACK_EXPLORED_ZOOM_IN`. */
export const EXPLORED_MAX_CELLS = 50_000;

const M_PER_DEG_LAT = 111_320;

const wrapX = (x: number) => ((x % TILES) + TILES) % TILES;
const lonTile = (lon: number) => Math.floor(((lon + 180) / 360) * TILES);

/**
 * The tiles a circle touches (its closest point inside the tile is within the
 * radius). A circle across the date line is split: its columns wrap round to
 * the other edge of the grid.
 */
export function circleCells(circle: ZoneCircle): Cell[] {
  const dLat = circle.radiusM / M_PER_DEG_LAT;
  const dLon = dLat / Math.max(0.01, Math.cos((circle.lat * Math.PI) / 180));
  const yMin = tileOf(circle.lat + dLat, circle.lon).y;
  const yMax = tileOf(circle.lat - dLat, circle.lon).y;
  const out = new Map<string, Cell>();
  // Unwrapped columns: a tile west of -180 or east of 180 is measured where it
  // lies (the haversine reads longitude differences round the sphere) and
  // stored under its wrapped column.
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

/** The four edge directions; columns wrap at the date line, rows do not. */
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

/** The cells of all circles, grouped into edge-connected components. */
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

/**
 * Which cells of one zone component are drawn (Codex review of a3353f2a7):
 * decided by the surroundings, never by the circle. A cell explored itself is
 * drawn. Any other cell looks along each of its four directions through the
 * component to the first cell outside it (or the first explored one): when at
 * least three of the four reach explored ground, it is drawn. Then, to a fixed
 * point, a cell with at least three edge neighbours explored or drawn is
 * drawn too. Deterministic and local to the component: no box enters it.
 *
 * So a zone inside explored ground fills in; one at the edge of explored
 * ground is drawn on the explored side up to the surroundings' edge; one
 * beside a single road, or nobody's ground, draws nothing — no footprint of
 * the circle either way.
 */
export function fillComponent(component: readonly Cell[], explored: ReadonlySet<string>): Cell[] {
  const inside = new Set(component.map(cellKey));
  const reaches = (from: Cell, edge: readonly [number, number]): boolean => {
    let c: Cell | null = from;
    for (let i = 0; i <= component.length; i++) {
      c = step(c, edge);
      if (!c) return false;
      const k = cellKey(c);
      if (explored.has(k)) return true;
      if (!inside.has(k)) return false;
    }
    return false;
  };
  const drawn = new Set<string>();
  for (const c of component) {
    const k = cellKey(c);
    if (explored.has(k)) drawn.add(k);
    else if (EDGES.filter((e) => reaches(c, e)).length >= CLOSED_OF_FOUR) drawn.add(k);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const c of component) {
      const k = cellKey(c);
      if (drawn.has(k)) continue;
      const closed = EDGES.filter((e) => {
        const n = step(c, e);
        return n !== null && (explored.has(cellKey(n)) || drawn.has(cellKey(n)));
      }).length;
      if (closed >= CLOSED_OF_FOUR) {
        drawn.add(k);
        changed = true;
      }
    }
  }
  return component.filter((c) => drawn.has(cellKey(c)));
}

/** Each component's drawn cells. */
function filledZoneCells(circles: readonly ZoneCircle[], explored: ReadonlySet<string>): Cell[] {
  const cells = circles.flatMap(circleCells);
  return zoneComponents(cells).flatMap((component) => fillComponent(component, explored));
}

/**
 * The cells to draw in `bbox`: the explored ones and the zone cells the rule
 * fills. `explored` must hold every explored cell in the box and every one in
 * or beside a circle's cells.
 */
export function exploredView({
  explored,
  circles,
  bbox,
}: {
  explored: readonly Cell[];
  circles: readonly ZoneCircle[];
  bbox: Bbox;
}): Cell[] {
  const ranges = bboxRanges(bbox);
  const exploredKeys = new Set(explored.map(cellKey));
  const out = new Map<string, Cell>();
  for (const c of explored) if (inRanges(c, ranges)) out.set(cellKey(c), { x: c.x, y: c.y });
  for (const c of filledZoneCells(circles, exploredKeys)) {
    if (inRanges(c, ranges)) out.set(cellKey(c), { x: c.x, y: c.y });
  }
  return sortCells(out.values());
}

/** The tile box of each circle, one cell wider on every side: where the rule looks for neighbours. */
export function zoneProbeRanges(circles: readonly ZoneCircle[]): TileRange[] {
  return circles.map((circle) => {
    const cells = circleCells(circle);
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    return {
      xMin: Math.min(...xs) - 1,
      xMax: Math.max(...xs) + 1,
      yMin: Math.min(...ys) - 1,
      yMax: Math.max(...ys) + 1,
    };
  });
}

async function exploredIn(userId: string, ranges: readonly TileRange[], limit: number) {
  const out: Cell[] = [];
  for (const r of ranges) {
    if (out.length >= limit) break;
    const rows = await prisma.$queryRaw<Cell[]>`
      SELECT DISTINCT x, y FROM travtrack_explored_cells
       WHERE user_id = ${userId}
         AND x BETWEEN ${r.xMin} AND ${r.xMax} AND y BETWEEN ${r.yMin} AND ${r.yMax}
       LIMIT ${limit - out.length}`;
    out.push(...rows);
  }
  return out;
}

const zoomIn = () =>
  new AppError("Too many explored cells in this area; zoom in", 400, "TRAVTRACK_EXPLORED_ZOOM_IN");

/**
 * `GET /travtrack/explored`: this account's cells in `bbox`, zone rule
 * applied. Reads only the account's own cells and circles.
 */
export async function exploredAnswer(userId: string, bbox: Bbox): Promise<{ cells: Cell[] }> {
  const circles = (await privacyCirclesFor(userId, 0)).filter((c) => c.radiusM > 0);
  const inBox = await exploredIn(userId, bboxRanges(bbox), EXPLORED_MAX_CELLS + 1);
  if (inBox.length > EXPLORED_MAX_CELLS) throw zoomIn();
  const nearZones = circles.length
    ? await exploredIn(userId, zoneProbeRanges(circles), EXPLORED_MAX_CELLS)
    : [];
  const cells = exploredView({ explored: [...inBox, ...nearZones], circles, bbox });
  if (cells.length > EXPLORED_MAX_CELLS) throw zoomIn();
  return { cells };
}
