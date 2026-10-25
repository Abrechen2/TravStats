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
 * The circles are the zones in force AND every former zone's circle:
 * points inside one were deleted when it was made, so its old hole would
 * outline it just the same. They are rasterised once per zone change into
 * `travtrack_zone_cells` (`zoneCells.ts`); a request reads the zones touching
 * its box and decides each WHOLE, never the part inside the box, so panning
 * or a smaller box cannot change what a cell shows.
 */
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import type { ZoneCircle } from "../classify";
import { Prisma } from "../../../prisma";
import {
  bboxRanges,
  cellKey,
  inRanges,
  sortCells,
  TILES,
  type Bbox,
  type Cell,
  type TileRange,
} from "./cells";
import { ensureZoneCells } from "./zoneCells";
import { circleCells, fillComponent, zoneComponents } from "./zoneRaster";

/** The most cells one answer carries; more → 400 `TRAVTRACK_EXPLORED_ZOOM_IN`. */
export const EXPLORED_MAX_CELLS = 50_000;

export { circleCells } from "./zoneRaster";

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

const rangesSql = (ranges: readonly TileRange[]) =>
  Prisma.join(
    ranges.map(
      (r) => Prisma.sql`(x BETWEEN ${r.xMin} AND ${r.xMax} AND y BETWEEN ${r.yMin} AND ${r.yMax})`
    ),
    " OR "
  );

const zoomIn = () =>
  new AppError("Too many explored cells in this area; zoom in", 400, "TRAVTRACK_EXPLORED_ZOOM_IN");

/**
 * The zones touching the box, each decided WHOLE: all of its cells and the
 * explored state of each and of its edge neighbours, never cut to the box. So
 * a box that ends inside a zone answers for it what the whole map answers.
 */
async function filledZonesIn(userId: string, ranges: readonly TileRange[]): Promise<Cell[]> {
  const components = await prisma.$queryRaw<{ component: number }[]>`
    SELECT DISTINCT component FROM travtrack_zone_cells
     WHERE user_id = ${userId} AND (${rangesSql(ranges)})`;
  if (components.length === 0) return [];
  const ids = components.map((c) => c.component);
  const [cells, near] = await Promise.all([
    prisma.$queryRaw<(Cell & { component: number })[]>`
      SELECT x, y, component FROM travtrack_zone_cells
       WHERE user_id = ${userId} AND component = ANY(${ids}::int[])`,
    // Each zone cell and its edge neighbours (columns wrap at the date line).
    prisma.$queryRaw<Cell[]>`
      SELECT DISTINCT e.x, e.y FROM travtrack_zone_cells z
        JOIN travtrack_explored_cells e
          ON e.user_id = z.user_id AND e.y BETWEEN z.y - 1 AND z.y + 1
         AND (e.x BETWEEN z.x - 1 AND z.x + 1
              OR (z.x = 0 AND e.x = ${TILES - 1}) OR (z.x = ${TILES - 1} AND e.x = 0))
       WHERE z.user_id = ${userId} AND z.component = ANY(${ids}::int[])`,
  ]);
  const explored = new Set(near.map(cellKey));
  const byComponent = new Map<number, Cell[]>();
  for (const c of cells) {
    const list = byComponent.get(c.component) ?? [];
    list.push({ x: c.x, y: c.y });
    byComponent.set(c.component, list);
  }
  return [...byComponent.values()].flatMap((component) => fillComponent(component, explored));
}

/**
 * `GET /travtrack/explored`: this account's cells in `bbox`, zone rule
 * applied. Reads only the account's own rows, in a fixed number of bounded
 * queries: the raster check, the box's cells, the zones touching the box.
 */
export async function exploredAnswer(userId: string, bbox: Bbox): Promise<{ cells: Cell[] }> {
  // Fail closed for the whole view: a raster too large to hold is never
  // answered in part, since any part could outline a zone.
  if ((await ensureZoneCells(userId)).overflow) {
    throw new AppError(
      "The explored map is not available for privacy zones this large",
      409,
      "TRAVTRACK_EXPLORED_UNAVAILABLE"
    );
  }
  const ranges = bboxRanges(bbox);
  const inBox = await prisma.$queryRaw<Cell[]>`
    SELECT DISTINCT x, y FROM travtrack_explored_cells
     WHERE user_id = ${userId} AND (${rangesSql(ranges)})
     LIMIT ${EXPLORED_MAX_CELLS + 1}`;
  if (inBox.length > EXPLORED_MAX_CELLS) throw zoomIn();
  const out = new Map<string, Cell>();
  for (const c of inBox) out.set(cellKey(c), { x: c.x, y: c.y });
  for (const c of await filledZonesIn(userId, ranges)) {
    if (inRanges(c, ranges)) out.set(cellKey(c), c);
  }
  if (out.size > EXPLORED_MAX_CELLS) throw zoomIn();
  return { cells: sortCells(out.values()) };
}
