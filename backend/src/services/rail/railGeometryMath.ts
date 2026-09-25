import { calculateDistance } from "../../utils/geo";

/**
 * Pure geometry for rail lines (spec 2026-09-25-rail-domain, "Geometry").
 * Coordinates are `[lon, lat]`, as GeoJSON and the stored `geometry` column
 * have them.
 */
export type LonLat = [number, number];

/**
 * A segment longer than this is not a traced track but a feed without shapes
 * drawing station-to-station chords (Transitous' own warning; ~35 km in the
 * rail API research). A line containing one is stored as `straight`, never
 * presented as the train's path.
 */
export const MAX_PLAUSIBLE_SEGMENT_KM = 35;

/**
 * How far a station may lie from the traced line and still be taken as a stop
 * on it. Wider than a platform, narrower than the next town.
 */
export const MAX_STATION_OFFSET_KM = 2;

/** Google's encoded polyline, at the precision the provider states (MOTIS: 6). */
export function decodePolyline(encoded: string, precision: number): LonLat[] {
  const factor = 10 ** precision;
  const points: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error("truncated polyline");
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push([lon / factor, lat / factor]);
  }
  return points;
}

const km = (a: LonLat, b: LonLat): number => calculateDistance(a[1], a[0], b[1], b[0]);

export function lineLengthKm(line: readonly LonLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += km(line[i - 1], line[i]);
  return total;
}

/** True when every segment is short enough to be a traced track. */
export function isTracedShape(line: readonly LonLat[]): boolean {
  if (line.length < 2) return false;
  for (let i = 1; i < line.length; i++) {
    if (km(line[i - 1], line[i]) > MAX_PLAUSIBLE_SEGMENT_KM) return false;
  }
  return true;
}

function nearestIndex(
  line: readonly LonLat[],
  point: LonLat,
  from: number
): { index: number; km: number } {
  let best = { index: -1, km: Number.POSITIVE_INFINITY };
  for (let i = from; i < line.length; i++) {
    const d = km(line[i], point);
    if (d < best.km) best = { index: i, km: d };
  }
  return best;
}

/**
 * The part of a whole trip's line between two stations, with the stations'
 * own positions as its ends. Null when either station is not on the line, or
 * the arrival comes before the departure along it — a line that does not
 * connect the two stations is no line for this journey.
 */
export function sliceBetween(line: readonly LonLat[], dep: LonLat, arr: LonLat): LonLat[] | null {
  const start = nearestIndex(line, dep, 0);
  if (start.index < 0 || start.km > MAX_STATION_OFFSET_KM) return null;
  const end = nearestIndex(line, arr, start.index);
  if (end.index <= start.index || end.km > MAX_STATION_OFFSET_KM) return null;
  return [dep, ...line.slice(start.index + 1, end.index), arr];
}
