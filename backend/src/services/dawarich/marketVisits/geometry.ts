import { VENUE_TYPES, type VenueType } from "./venueTypes";

/** WGS84 GeoJSON order: longitude, latitude. Small local market areas only. */
export type Position = readonly [number, number];
export type Ring = readonly Position[];
export type Polygon = readonly Ring[];
export type MarketGeometry =
  | { type: "Polygon"; coordinates: Polygon }
  | { type: "MultiPolygon"; coordinates: readonly Polygon[] };
export interface MarketArea {
  id: string;
  name: string;
  sourceUrl: string;
  /** Shared public identity, e.g. wikidata:Q490809; not a name similarity. */
  entityRef?: string;
  /** Absent in legacy market snapshots. */
  venueType?: VenueType;
  geometry: MarketGeometry;
  /** Explicit parent venue, never inferred merely from nearby coordinates. */
  parentId?: string;
}
export const polygons = (area: MarketArea): readonly Polygon[] =>
  area.geometry.type === "Polygon" ? [area.geometry.coordinates] : area.geometry.coordinates;

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1],
      [bx, by] = ring[i];
    if (ay > lat !== by > lat && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
export function contains(area: MarketArea, lon: number, lat: number): boolean {
  return polygons(area).some(
    ([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h))
  );
}
function edgeDistance(lon: number, lat: number, ring: Ring): number {
  const sx = 111_320 * Math.cos((lat * Math.PI) / 180);
  let nearest = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1],
      b = ring[i];
    const ax = (a[0] - lon) * sx,
      ay = (a[1] - lat) * 111_320;
    const dx = (b[0] - a[0]) * sx,
      dy = (b[1] - a[1]) * 111_320;
    const n = dx * dx + dy * dy;
    const t = n ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / n)) : 0;
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return nearest;
}
/** Holes remain excluded, including their tolerance strip. */
export function distanceToArea(area: MarketArea, lon: number, lat: number): number {
  if (contains(area, lon, lat)) return 0;
  const distances = polygons(area).map(([outer, ...holes]) =>
    holes.some((h) => inRing(lon, lat, h)) ? Infinity : edgeDistance(lon, lat, outer)
  );
  return Math.min(...distances);
}

export function validateAreas(areas: readonly MarketArea[]): void {
  const ids = new Set<string>();
  for (const area of areas) {
    if (!area.id || !area.name?.trim() || !/^https?:\/\//.test(area.sourceUrl) || ids.has(area.id))
      throw new Error("Market areas require unique ids, names and source URLs");
    if (area.venueType !== undefined && !VENUE_TYPES.includes(area.venueType))
      throw new Error("Unsupported venue type");
    ids.add(area.id);
    if (!["Polygon", "MultiPolygon"].includes(area.geometry?.type))
      throw new Error("A market point is not a market area");
    if (!polygons(area).length) throw new Error("Empty market geometry");
    let size = 0;
    const vertices = polygons(area).flat(2);
    if (vertices.length > 20000) throw new Error("Market geometry exceeds the preview limit");
    const origin = vertices[0];
    if (vertices.some((p) => Math.abs(p[0] - origin[0]) > 0.1 || Math.abs(p[1] - origin[1]) > 0.1))
      throw new Error("A market must be a local area, not distant venues");
    for (const polygon of polygons(area)) {
      if (!polygon.length) throw new Error("Empty market polygon");
      for (const ring of polygon) {
        if (ring.length < 4) throw new Error("Market rings must be closed");
        const first = ring[0],
          last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) throw new Error("Open market ring");
        const [baseLon, baseLat] = first;
        for (const p of ring) {
          if (
            p.length !== 2 ||
            !Number.isFinite(p[0]) ||
            !Number.isFinite(p[1]) ||
            Math.abs(p[0]) > 180 ||
            Math.abs(p[1]) > 90 ||
            Math.abs(p[0] - baseLon) > 0.1 ||
            Math.abs(p[1] - baseLat) > 0.1
          )
            throw new Error("Invalid or non-local market geometry");
        }
        const twiceArea = ring
          .slice(1)
          .reduce(
            (sum, p, i) =>
              sum +
              (ring[i][0] - baseLon) * (p[1] - baseLat) -
              (p[0] - baseLon) * (ring[i][1] - baseLat),
            0
          );
        size += Math.abs(twiceArea);
      }
    }
    if (!size) throw new Error("Degenerate market geometry");
  }
  for (const area of areas) {
    const seen = new Set([area.id]);
    let parent = area.parentId;
    while (parent) {
      if (!ids.has(parent) || seen.has(parent)) throw new Error("Invalid market parent hierarchy");
      seen.add(parent);
      const ancestor = areas.find((a) => a.id === parent)!;
      if ((ancestor.venueType ?? "market") !== (area.venueType ?? "market"))
        throw new Error("Independent venue types cannot be merged as parts");
      parent = ancestor.parentId;
    }
  }
}
