/**
 * What the explored map shows (TravTrack plan L1, review focus 26) — one
 * output format and one privacy model:
 *
 *   - Always zoom-14 cells (`cells.ts`), never a time, never a point.
 *   - Privacy zones are shown as explored ground, never as a hole and never
 *     as a shape of their own. No point is stored inside a zone, so its cells
 *     would read as unexplored and its outline would show as a hole in a
 *     walked-through area. The fixed display rule instead: every cell a
 *     privacy circle touches is drawn when it connects — edge to edge, through
 *     cells such circles touch — to an explored cell. A ring of explored
 *     ground fills the whole zone, a road along one side fills it too (a
 *     single pass over the edge would draw a bite), and a zone nobody moved
 *     next to draws nothing. The legend says so ("Privatzonen werden als
 *     erkundet gezeigt").
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
  tileBounds,
  tileOf,
  type Bbox,
  type Cell,
  type TileRange,
} from "./cells";

/** The most cells one answer carries; more → 400 `TRAVTRACK_EXPLORED_ZOOM_IN`. */
export const EXPLORED_MAX_CELLS = 50_000;

const M_PER_DEG_LAT = 111_320;

/** The tiles a circle touches (its closest point inside the tile is within the radius). */
export function circleCells(circle: ZoneCircle): Cell[] {
  const dLat = circle.radiusM / M_PER_DEG_LAT;
  const dLon = dLat / Math.max(0.01, Math.cos((circle.lat * Math.PI) / 180));
  const nw = tileOf(circle.lat + dLat, circle.lon - dLon);
  const se = tileOf(circle.lat - dLat, circle.lon + dLon);
  const out: Cell[] = [];
  for (let x = nw.x; x <= se.x; x++) {
    for (let y = nw.y; y <= se.y; y++) {
      const b = tileBounds({ x, y });
      const nearest = {
        lat: Math.min(b.north, Math.max(b.south, circle.lat)),
        lon: Math.min(b.east, Math.max(b.west, circle.lon)),
      };
      if (distanceM(circle, nearest) <= circle.radiusM) out.push({ x, y });
    }
  }
  return out;
}

const EDGES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The cells of all circles, grouped into edge-connected components. */
function zoneComponents(circles: readonly ZoneCircle[]): Cell[][] {
  const cells = new Map<string, Cell>();
  for (const circle of circles) for (const c of circleCells(circle)) cells.set(cellKey(c), c);
  const seen = new Set<string>();
  const components: Cell[][] = [];
  for (const [startKey, start] of cells) {
    if (seen.has(startKey)) continue;
    seen.add(startKey);
    const component: Cell[] = [];
    const queue = [start];
    while (queue.length > 0) {
      const c = queue.pop()!;
      component.push(c);
      for (const [dx, dy] of EDGES) {
        const k = cellKey({ x: c.x + dx, y: c.y + dy });
        const next = cells.get(k);
        if (next && !seen.has(k)) {
          seen.add(k);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Each component, and whether an explored cell is in it or on one of its edges. */
function filledZoneCells(circles: readonly ZoneCircle[], explored: ReadonlySet<string>): Cell[] {
  const out: Cell[] = [];
  for (const component of zoneComponents(circles)) {
    const touched = component.some(
      (c) =>
        explored.has(cellKey(c)) ||
        EDGES.some(([dx, dy]) => explored.has(cellKey({ x: c.x + dx, y: c.y + dy })))
    );
    if (touched) out.push(...component);
  }
  return out;
}

/**
 * The cells to draw in `bbox`: the explored ones and the zone cells the rule
 * fills. `explored` must hold every explored cell in the box and every one in
 * or beside a circle's cells (`zoneProbeRanges`).
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
