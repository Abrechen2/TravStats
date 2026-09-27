/**
 * Generates the demo account's train lines — ONCE, with the network — into
 * `src/seedData/demo/rail-lines.json.gz`. The seed itself never calls a
 * router: it runs on first boot, possibly offline.
 *
 *   npx tsx scripts/demo/generateDemoRailGeometry.ts           # uses the cache
 *   npx tsx scripts/demo/generateDemoRailGeometry.ts --refetch # asks BRouter again
 *
 * Source: BRouter (brouter.de) with its `rail` profile, which routes over the
 * OpenStreetMap railway network — the same public service the tour tracks
 * come from (see `src/seedData/demo/SOURCES.md`). The OpenRailRouting public
 * instance was not used: it publishes no terms for scripted use, and its
 * "Terms" link is GraphHopper's commercial API terms.
 *
 * Each station pair is asked once, stretch by stretch through the route's
 * `via` points, and cached; a ride in the other direction reads the same line
 * reversed.
 */
import fs from "fs";
import path from "path";

import { cachedFetchJson } from "./cachedFetch";
import { simplifyDegrees } from "../../src/services/schematicRouter";
import { densifyLine, isTracedShape, sliceBetween } from "../../src/services/rail/railGeometryMath";
import {
  GEOMETRY_DIR,
  RAIL_FILE,
  decodeLine,
  encodePolyline,
  writeGeometryFile,
  type StoredRailLine,
} from "../../src/seedDemo/realistic/geometryFile";
import { RAIL_ROUTES, railRouteKey } from "../../src/seedDemo/realistic/data/railRoutes";
import { STATIONS } from "../../src/seedDemo/realistic/data/stations";

/** ~20 m: a train line has no hairpins worth more on a map. */
const TOLERANCE_DEG = 0.0002;
const MAX_POINTS = 1500;
/**
 * No stored segment longer than this: a long straight stretch simplified to
 * one segment would read as a chord to the rail edit rule (`isTracedShape`).
 */
const MAX_SEGMENT_KM = 10;

type LonLat = [number, number];

function simplifyCapped(line: LonLat[]): LonLat[] {
  let tolerance = TOLERANCE_DEG;
  let out = simplifyDegrees(line, tolerance);
  while (out.length > MAX_POINTS) {
    tolerance *= 1.5;
    out = simplifyDegrees(line, tolerance);
  }
  return densifyLine(out, MAX_SEGMENT_KM);
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

async function routeRail(spec: (typeof RAIL_ROUTES)[number]): Promise<StoredRailLine> {
  const key = railRouteKey(spec.from, spec.to);
  const from = STATIONS[spec.from];
  const to = STATIONS[spec.to];
  const points: Array<[number, number]> = [
    [from.lon, from.lat],
    ...spec.via.map(([lat, lon]) => [lon, lat] as [number, number]),
    [to.lon, to.lat],
  ];
  // One request per stretch between two points: brouter.de cuts a long
  // request off after 8 s ("thread-priority-watchdog"), and a stretch between
  // two via points is short enough to answer well inside that.
  const raw: LonLat[] = [];
  let metres = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const url =
      `https://brouter.de/brouter?lonlats=${a[0]},${a[1]}|${b[0]},${b[1]}` +
      `&profile=rail&alternativeidx=0&format=geojson`;
    const body = await cachedFetchJson(url, `brouter-rail-${key}-${i}`);
    const features = body.features as Array<{
      geometry: { coordinates: number[][] };
      properties: { "track-length": string };
    }>;
    if (!features?.length) throw new Error(`${key}: BRouter returned no line for stretch ${i}`);
    const part = features[0].geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat);
    raw.push(...(raw.length > 0 ? part.slice(1) : part));
    metres += Number(features[0].properties["track-length"]);
  }
  const line = simplifyCapped(raw).map(([lon, lat]) => [round5(lon), round5(lat)] as LonLat);
  // The stored line must run between the two stations, or the seed would draw
  // a line that does not reach them — the same test a Transitous slice passes.
  const fromPos: LonLat = [from.lon, from.lat];
  const toPos: LonLat = [to.lon, to.lat];
  if (!sliceBetween(line, fromPos, toPos) || !isTracedShape(line)) {
    throw new Error(`${key}: the routed line does not connect the two stations`);
  }
  const km = Math.round(metres / 100) / 10;
  process.stdout.write(`  ${key}: ${line.length} points, ${km} km\n`);
  return { w: encodePolyline(line), km };
}

async function main(): Promise<void> {
  fs.mkdirSync(GEOMETRY_DIR, { recursive: true });
  const lines: Record<string, StoredRailLine> = {};
  for (const spec of RAIL_ROUTES) lines[railRouteKey(spec.from, spec.to)] = await routeRail(spec);
  writeGeometryFile(RAIL_FILE, lines, GEOMETRY_DIR);
  // Read back what was written, so a codec slip fails here and not in a seed.
  for (const [key, stored] of Object.entries(lines)) {
    if (decodeLine(stored.w).length < 2) throw new Error(`${key}: stored line unreadable`);
  }
  const size = fs.statSync(path.join(GEOMETRY_DIR, RAIL_FILE)).size;
  process.stdout.write(`${RAIL_FILE}: ${(size / 1024).toFixed(0)} KiB\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
