import fs from "fs";
import path from "path";
import zlib from "zlib";

import { decodePolyline } from "../../services/rail/railGeometryMath";

/**
 * The shape of the generated geometry files in `seedData/demo/`, and the one
 * reader and writer of them. The generators (`scripts/demo/generateDemo*.ts`)
 * write them once, with the network; the seed only ever reads them, without it.
 */

/** Precision of every encoded line: five decimals, about a metre. */
export const POLYLINE_PRECISION = 5;

/** One routed roadtrip leg. */
export interface StoredLeg {
  /** Encoded polyline of the simplified route, `lat,lon` pairs as Google encodes them. */
  w: string;
  /** Routed length in km, measured on the router's full-resolution line. */
  km: number;
  /** Router's driving time in minutes; null for a drawn (ferry) line. */
  min: number | null;
  /** `routed` when a router drew it, `drawn` for a ferry crossing traced by hand. */
  src: "routed" | "drawn";
}

/** One recorded track: every point, its elevation and its time since the start. */
export interface StoredTrack {
  p: string;
  /** Metres above sea level, one per point. */
  e: number[];
  /** Seconds since the recording started, one per point. */
  t: number[];
}

/** One train ride's line over the rail network, keyed by `railRouteKey`. */
export interface StoredRailLine {
  /** Encoded polyline, simplified to ~20 m, from the first station to the second. */
  w: string;
  /** Routed length in km, measured on the router's full-resolution line. */
  km: number;
}

export const GEOMETRY_DIR = path.resolve(__dirname, "..", "..", "seedData", "demo");
export const LEGS_FILE = "roadtrip-legs.json.gz";
export const TRACKS_FILE = "tour-tracks.json.gz";
export const RAIL_FILE = "rail-lines.json.gz";

export function readGeometryFile<T>(file: string, dir: string = GEOMETRY_DIR): Record<string, T> {
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(dir, file))).toString("utf-8");
  return JSON.parse(raw) as Record<string, T>;
}

export function writeGeometryFile(file: string, data: Record<string, unknown>, dir: string): void {
  const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
  // mtime 0 in the gzip header keeps a regenerated file byte-identical when
  // nothing in it changed, so a rerun is not a diff.
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(sorted)), { level: 9 });
  gz.writeUInt32LE(0, 4);
  fs.writeFileSync(path.join(dir, file), gz);
}

/** `[lon, lat]` pairs → Google encoded polyline. */
export function encodePolyline(points: ReadonlyArray<readonly [number, number]>): string {
  const factor = 10 ** POLYLINE_PRECISION;
  let out = "";
  let prevLat = 0;
  let prevLon = 0;
  const put = (value: number): void => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of points) {
    const la = Math.round(lat * factor);
    const lo = Math.round(lon * factor);
    put(la - prevLat);
    put(lo - prevLon);
    prevLat = la;
    prevLon = lo;
  }
  return out;
}

/** The inverse of `encodePolyline`, `[lon, lat]` pairs in GeoJSON order. */
export function decodeLine(encoded: string): Array<[number, number]> {
  return decodePolyline(encoded, POLYLINE_PRECISION).map(([lon, lat]) => [lon, lat]);
}
