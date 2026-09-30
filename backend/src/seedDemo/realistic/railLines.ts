import type { LonLat } from "../../services/rail/railGeometryMath";
import { RAIL_ROUTES, railRouteKey } from "./data/railRoutes";
import { STATIONS, type StationKey } from "./data/stations";
import { RAIL_FILE, decodeLine, readGeometryFile, type StoredRailLine } from "./geometryFile";

/**
 * The line a demo train ride is drawn with, read from the file the rail
 * generator wrote (`scripts/demo/generateDemoRailGeometry.ts`) — never asked
 * of a router at seed time. A ride in the other direction takes the same line
 * reversed. The stations' own positions are its ends, as a Transitous slice
 * has them.
 *
 * A pair without a stored line is an error, not a quiet chord: the demo's
 * whole point is that its rides are drawn over the tracks, so a new ride
 * needs its line generated first.
 */

let lines: Record<string, StoredRailLine> | null = null;

export interface DemoRailLine {
  geometry: LonLat[];
  km: number;
}

export function demoRailLine(from: StationKey, to: StationKey): DemoRailLine {
  lines ??= readGeometryFile<StoredRailLine>(RAIL_FILE);
  const forward = RAIL_ROUTES.some((r) => r.from === from && r.to === to);
  const key = forward ? railRouteKey(from, to) : railRouteKey(to, from);
  const stored = lines[key];
  if (!stored) throw new Error(`Demo seed: no stored rail line for ${from} → ${to}`);
  const decoded = decodeLine(stored.w);
  const line = forward ? decoded : [...decoded].reverse();
  const a = STATIONS[from];
  const b = STATIONS[to];
  return {
    geometry: [[a.lon, a.lat], ...line.slice(1, -1), [b.lon, b.lat]],
    km: stored.km,
  };
}
