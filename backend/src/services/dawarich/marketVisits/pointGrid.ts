import type { StayPoint } from "../stays/detect";
import { polygons, type MarketArea } from "./geometry";

/** Grid cell edge in degrees; about one kilometre, the size of a large venue. */
const CELL_DEGREES = 0.01;

export interface Bounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/**
 * Bounding box of an area, or null for an area without vertices. A loop, not
 * Math.min(...vertices): an OSM relation with a few hundred thousand vertices
 * overflowed the call stack and failed the scan.
 */
export function boundsOf(area: MarketArea): Bounds | null {
  let minLon = Infinity,
    maxLon = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const polygon of polygons(area))
    for (const ring of polygon)
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
  return Number.isFinite(minLon) ? { minLon, maxLon, minLat, maxLat } : null;
}

const cellOf = (degrees: number) => Math.floor(degrees / CELL_DEGREES);

/**
 * Spatial index over time-sorted points: for a box, the indices of the first
 * and last point inside it. Each area then reads its own stretch of the
 * timeline instead of every point.
 */
export function pointGrid(points: readonly StayPoint[]) {
  const cells = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = `${cellOf(p.latitude)}:${cellOf(p.longitude)}`;
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  });
  const inside = (p: StayPoint, b: Bounds) =>
    p.longitude >= b.minLon &&
    p.longitude <= b.maxLon &&
    p.latitude >= b.minLat &&
    p.latitude <= b.maxLat;
  return {
    span(
      minLat: number,
      maxLat: number,
      minLon: number,
      maxLon: number
    ): { first: number; last: number } | null {
      const box = { minLat, maxLat, minLon, maxLon };
      let first = Infinity,
        last = -Infinity;
      const take = (i: number) => {
        if (!inside(points[i], box)) return;
        if (i < first) first = i;
        if (i > last) last = i;
      };
      const rows = cellOf(maxLat) - cellOf(minLat) + 1;
      const cols = cellOf(maxLon) - cellOf(minLon) + 1;
      if (rows * cols > cells.size) {
        // A box wider than the occupied cells: walking the points is cheaper.
        for (let i = 0; i < points.length; i++) take(i);
      } else {
        for (let r = cellOf(minLat); r <= cellOf(maxLat); r++)
          for (let c = cellOf(minLon); c <= cellOf(maxLon); c++)
            for (const i of cells.get(`${r}:${c}`) ?? []) take(i);
      }
      return Number.isFinite(first) ? { first, last } : null;
    },
  };
}
