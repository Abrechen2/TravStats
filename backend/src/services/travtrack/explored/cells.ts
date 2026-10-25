/**
 * The explored map's grid (TravTrack plan L1): Web-Mercator tiles at zoom 14
 * (about 2.4 km at the equator, 1.5 km in Berlin) — the ONE resolution stored
 * and the one served, whatever the map's zoom. A second, coarser or finer
 * answer would differ from this one exactly where something was left out, and
 * that difference could outline a privacy zone (review focus 26).
 *
 * Pure: no database, no clock.
 */

export const EXPLORED_ZOOM = 14;
/** Tiles per axis at `EXPLORED_ZOOM`. */
export const TILES = 2 ** EXPLORED_ZOOM;
/** Web-Mercator's latitude limit: the grid ends here. */
export const MAX_LAT = 85.0511287798066;

export type Cell = { x: number; y: number };
export type Bbox = { west: number; south: number; east: number; north: number };
/** An inclusive rectangle of tiles. */
export type TileRange = { xMin: number; xMax: number; yMin: number; yMax: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clampTile = (v: number) => clamp(Math.floor(v), 0, TILES - 1);

const tileX = (lon: number) => clampTile(((lon + 180) / 360) * TILES);
function tileY(lat: number): number {
  const r = (clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
  return clampTile(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILES);
}

const lonOf = (x: number) => (x / TILES) * 360 - 180;
const latOf = (y: number) => {
  const n = Math.PI - (2 * Math.PI * y) / TILES;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
};

/** The tile a position falls in. */
export const tileOf = (lat: number, lon: number): Cell => ({ x: tileX(lon), y: tileY(lat) });

/** The tile's edges in degrees; west and south inclusive. */
export const tileBounds = ({ x, y }: Cell): Bbox => ({
  west: lonOf(x),
  east: lonOf(x + 1),
  north: latOf(y),
  south: latOf(y + 1),
});

export const cellKey = ({ x, y }: Cell): string => `${x}/${y}`;

/** The distinct tiles of these positions, sorted by x, then y. */
export function cellsOfPoints(points: Iterable<{ lat: number; lon: number }>): Cell[] {
  const seen = new Map<string, Cell>();
  for (const p of points) {
    const cell = tileOf(p.lat, p.lon);
    seen.set(cellKey(cell), cell);
  }
  return sortCells(seen.values());
}

export function sortCells(cells: Iterable<Cell>): Cell[] {
  return [...cells].sort((a, b) => a.x - b.x || a.y - b.y);
}

/**
 * The tile ranges a box covers: one, or two when it crosses the antimeridian
 * (`west > east`).
 */
export function bboxRanges({ west, south, east, north }: Bbox): TileRange[] {
  const yMin = tileY(north);
  const yMax = tileY(south);
  if (west <= east) return [{ xMin: tileX(west), xMax: tileX(east), yMin, yMax }];
  return [
    { xMin: tileX(west), xMax: TILES - 1, yMin, yMax },
    { xMin: 0, xMax: tileX(east), yMin, yMax },
  ];
}

export const inRanges = ({ x, y }: Cell, ranges: readonly TileRange[]): boolean =>
  ranges.some((r) => x >= r.xMin && x <= r.xMax && y >= r.yMin && y <= r.yMax);
