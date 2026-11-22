import type { FeedPoint } from "./types";

type Extent = [number, number, number, number];

const usable = (p: { lat: number | null; lon: number | null }): p is FeedPoint =>
  p.lat !== null &&
  p.lon !== null &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lon) &&
  // (0, 0) is what an unresolved coordinate is stored as, not a place in the Gulf of Guinea.
  !(p.lat === 0 && p.lon === 0);

/**
 * Where the camera should go for an entry that touches these places: one
 * distinct place is a `point` to zoom to, two or more a `bbox` to fit. None
 * usable is `{point: null, bbox: null}` — the row then says it is not on the
 * map instead of flying to the Gulf of Guinea.
 */
export function focusOf(places: ReadonlyArray<{ lat: number | null; lon: number | null }>): {
  point: FeedPoint | null;
  bbox: Extent | null;
} {
  const pts = places.filter(usable);
  if (pts.length === 0) return { point: null, bbox: null };
  let west = Math.min(...pts.map((p) => p.lon));
  let east = Math.max(...pts.map((p) => p.lon));
  // Across the antimeridian (Tokyo to Los Angeles) the short way round is the
  // box from the eastern lons to the western ones shifted by 360, not the 250
  // degrees that span the whole map the wrong way.
  if (east - west > 180) {
    const shifted = pts.map((p) => (p.lon < 0 ? p.lon + 360 : p.lon));
    west = Math.min(...shifted);
    east = Math.max(...shifted);
  }
  const south = Math.min(...pts.map((p) => p.lat));
  const north = Math.max(...pts.map((p) => p.lat));
  if (west === east && south === north) return { point: { lat: south, lon: west }, bbox: null };
  return { point: null, bbox: [west, south, east, north] };
}
