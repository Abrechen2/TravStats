/**
 * Generates the demo account's road and trail geometry — ONCE, with the
 * network — into `src/seedData/demo/`. The seed itself never calls a router:
 * it runs on first boot, possibly offline.
 *
 *   npx tsx scripts/demo/generateDemoGeometry.ts           # uses the cache
 *   npx tsx scripts/demo/generateDemoGeometry.ts --refetch # asks the routers again
 *
 * Sources (see `src/seedData/demo/SOURCES.md` for the licences):
 *   - roadtrip legs: the FOSSGIS OSRM car router, routing.openstreetmap.de
 *   - recorded tracks: BRouter, brouter.de (hiking-mountain / trekking), which
 *     returns every point with its SRTM elevation
 *
 * Both are public services run by volunteers. The script asks each question
 * once, pauses between requests, sends a User-Agent that says what it is, and
 * caches every raw answer under `scripts/demo/.cache/` so a rerun that changes
 * only the post-processing (simplification, timestamps) costs no request.
 */
import fs from "fs";
import path from "path";

import { simplifyDegrees } from "../../src/services/schematicRouter";
import { haversineKm } from "../../src/shared/geo/haversine";
import {
  GEOMETRY_DIR,
  LEGS_FILE,
  TRACKS_FILE,
  decodeLine,
  encodePolyline,
  writeGeometryFile,
  type StoredLeg,
  type StoredTrack,
} from "../../src/seedDemo/realistic/geometryFile";
import {
  ROADTRIPS,
  TOURS,
  roadtripLegKey,
  type LatLon,
  type TrackSpec,
} from "../../src/seedDemo/realistic/data/routeSpecs";

const USER_AGENT = "TravStats-demo-geometry/1.0 (one-off generator for the demo account)";
const PAUSE_MS = 1500;
const CACHE_DIR = path.resolve(__dirname, ".cache");
const REFETCH = process.argv.includes("--refetch");

/** Simplification of a driven leg: ~30 m, and never more than this many points. */
const LEG_TOLERANCE_DEG = 0.0003;
const LEG_MAX_POINTS = 1200;

/** A GPS logger writes a point every few seconds; this is the spacing we densify to. */
const MAX_SPACING_M = { hike: 20, bike: 35 } as const;

type Json = Record<string, unknown>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cachedFetchJson(url: string, cacheKey: string): Promise<Json> {
  const file = path.join(CACHE_DIR, `${cacheKey.replace(/[^a-z0-9#-]/gi, "_")}.json`);
  if (!REFETCH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")) as Json;
  await sleep(PAUSE_MS);
  let res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  // A per-minute quota (Open-Meteo counts each coordinate): wait it out and
  // ask once more, rather than hammering or giving up.
  for (let attempt = 0; res.status === 429 && attempt < 12; attempt++) {
    const hourly = (await res.clone().text()).includes("Hourly");
    process.stdout.write(
      `  ${cacheKey}: rate-limited (${hourly ? "hourly" : "per minute"}), waiting\n`
    );
    await sleep(hourly ? 600_000 : 65_000);
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  }
  if (!res.ok) throw new Error(`${cacheKey}: ${url} answered ${res.status} ${await res.text()}`);
  const body = (await res.json()) as Json;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body));
  process.stdout.write(`  fetched ${cacheKey}\n`);
  return body;
}

function lineKm(line: ReadonlyArray<readonly [number, number]>): number {
  let km = 0;
  for (let i = 1; i < line.length; i++) {
    km += haversineKm(
      { lat: line[i - 1][1], lon: line[i - 1][0] },
      { lat: line[i][1], lon: line[i][0] }
    );
  }
  return km;
}

function simplifyCapped(line: Array<[number, number]>): Array<[number, number]> {
  let tolerance = LEG_TOLERANCE_DEG;
  let out = simplifyDegrees(line, tolerance);
  while (out.length > LEG_MAX_POINTS) {
    tolerance *= 1.5;
    out = simplifyDegrees(line, tolerance);
  }
  return out;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

// ------------------------------------------------------------------ roadtrips

async function routeCar(key: string, from: LatLon, to: LatLon): Promise<StoredLeg> {
  const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=polyline`;
  const body = await cachedFetchJson(url, `osrm-car-${key}`);
  const routes = body.routes as Array<{ geometry: string; distance: number; duration: number }>;
  if (body.code !== "Ok" || !routes?.length)
    throw new Error(`${key}: no route (${String(body.code)})`);
  const route = routes[0];
  const line = decodeLine(route.geometry);
  return {
    w: encodePolyline(simplifyCapped(line)),
    km: Math.round(route.distance / 100) / 10,
    min: Math.round(route.duration / 60),
    src: "routed",
  };
}

function drawnLeg(points: readonly LatLon[]): StoredLeg {
  const line = points.map(([lat, lon]) => [lon, lat] as [number, number]);
  return {
    w: encodePolyline(line),
    km: Math.round(lineKm(line) * 10) / 10,
    min: null,
    src: "drawn",
  };
}

async function generateLegs(): Promise<Record<string, StoredLeg>> {
  const legs: Record<string, StoredLeg> = {};
  for (const trip of ROADTRIPS) {
    for (let i = 0; i < trip.stations.length - 1; i++) {
      const key = roadtripLegKey(trip.key, i);
      const ferry = trip.ferries?.[i];
      const a = trip.stations[i];
      const b = trip.stations[i + 1];
      legs[key] = ferry ? drawnLeg(ferry) : await routeCar(key, [a.lat, a.lon], [b.lat, b.lon]);
    }
  }
  return legs;
}

// --------------------------------------------------------------------- tracks

type Point3 = [number, number, number];

async function routeTrail(track: TrackSpec, profile: string): Promise<Point3[]> {
  const lonlats = track.via.map(([lat, lon]) => `${lon},${lat}`).join("|");
  const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;
  const body = await cachedFetchJson(url, `brouter-${track.key}`);
  const features = body.features as Array<{ geometry: { coordinates: number[][] } }>;
  if (!features?.length) throw new Error(`${track.key}: BRouter returned no track`);
  const path2d = features[0].geometry.coordinates.map(([lon, lat]) => [lon, lat] as const);
  const elevations = smoothElevations(path2d, await elevationsFor(track.key, path2d));
  return path2d.map(([lon, lat], i) => [lon, lat, elevations[i]]);
}

/** Half-width of the running median over the DEM samples, in metres along the line. */
const ELEVATION_MEDIAN_HALF_M = 500;

/**
 * A running median over ±`ELEVATION_MEDIAN_HALF_M` of the line.
 *
 * A 90 m DEM cell beside a river is half valley wall: the Mosel cycle path,
 * which sits a few metres above the water from Trier to Koblenz, came out of
 * the raw samples with steps of up to 75 m between neighbours and "Aufstieg
 * 6.283 m" over its four days (acceptance run, 2026-09-26) — noise the 5 m
 * hysteresis in `trackMetrics.ts` rightly keeps, because it is far above any
 * logger's jitter. Measured against BRouter's own filtered ascent: the Mosel
 * falls from 6,283 m to about 950 m, and the mountain hikes stay within
 * about 20 % of it (Alta Via day 1: 813 m against 870 m).
 */
function smoothElevations(
  points: ReadonlyArray<readonly [number, number]>,
  elevations: readonly number[]
): number[] {
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    const [lon0, lat0] = points[i - 1];
    const [lon1, lat1] = points[i];
    along.push(
      along[i - 1] + haversineKm({ lat: lat0, lon: lon0 }, { lat: lat1, lon: lon1 }) * 1000
    );
  }
  const out: number[] = [];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < points.length; i++) {
    while (along[i] - along[lo] > ELEVATION_MEDIAN_HALF_M) lo++;
    while (hi < points.length - 1 && along[hi + 1] - along[i] <= ELEVATION_MEDIAN_HALF_M) hi++;
    const window = elevations.slice(lo, hi + 1).sort((a, b) => a - b);
    out.push(window[Math.floor((window.length - 1) / 2)]);
  }
  return out;
}

/**
 * Elevation from Open-Meteo's elevation API (Copernicus DEM GLO-90), 100
 * points per request. BRouter's own elevation is ignored on purpose: its
 * tiles' licence is less clear than Copernicus', and one source for every
 * track keeps the profiles comparable.
 */
async function elevationsFor(
  key: string,
  points: ReadonlyArray<readonly [number, number]>
): Promise<number[]> {
  const out: number[] = [];
  for (let start = 0; start < points.length; start += 100) {
    const batch = points.slice(start, start + 100);
    const lat = batch.map(([, la]) => la.toFixed(5)).join(",");
    const lon = batch.map(([lo]) => lo.toFixed(5)).join(",");
    const body = await cachedFetchJson(
      `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`,
      `elev-${key}-${start}`
    );
    const values = body.elevation as number[] | undefined;
    if (!values || values.length !== batch.length)
      throw new Error(`${key}: elevation batch ${start} incomplete`);
    out.push(...values);
  }
  return out;
}

/** Inserts interpolated points so no two neighbours are further apart than `maxM`. */
function densify(points: Point3[], maxM: number): Point3[] {
  const out: Point3[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [lon0, lat0, e0] = points[i - 1];
    const [lon1, lat1, e1] = points[i];
    const m = haversineKm({ lat: lat0, lon: lon0 }, { lat: lat1, lon: lon1 }) * 1000;
    const steps = Math.ceil(m / maxM);
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      out.push([lon0 + (lon1 - lon0) * f, lat0 + (lat1 - lat0) * f, e0 + (e1 - e0) * f]);
    }
    if (m > 0.5) out.push(points[i]);
  }
  return out;
}

/** Walking speed in km/h on a grade (Tobler's hiking function, with a rucksack). */
const hikeKmh = (grade: number) =>
  Math.max(1.3, 0.88 * 6 * Math.exp(-3.5 * Math.abs(grade + 0.05)));

/** Touring bike with luggage: ~17 km/h on the flat, slower uphill, capped downhill. */
const bikeKmh = (grade: number) =>
  grade >= 0 ? Math.max(7, 17 - 150 * grade) : Math.min(27, 17 - 90 * grade);

/** Grade over a window of ~120 m around each step, so the DEM's staircase does not jerk the pace. */
function smoothedGrades(points: Point3[], cumKm: number[]): number[] {
  const grades: number[] = [0];
  let lo = 0;
  let hi = 0;
  for (let i = 1; i < points.length; i++) {
    while (cumKm[i] - cumKm[lo] > 0.06) lo++;
    while (hi < points.length - 1 && cumKm[hi] - cumKm[i] < 0.06) hi++;
    const run = (cumKm[hi] - cumKm[lo]) * 1000;
    grades.push(run > 1 ? (points[hi][2] - points[lo][2]) / run : 0);
  }
  return grades;
}

function timestamps(points: Point3[], track: TrackSpec): { points: Point3[]; t: number[] } {
  const cumKm = [0];
  for (let i = 1; i < points.length; i++) {
    cumKm.push(
      cumKm[i - 1] +
        haversineKm(
          { lat: points[i - 1][1], lon: points[i - 1][0] },
          { lat: points[i][1], lon: points[i][0] }
        )
    );
  }
  const total = cumKm[cumKm.length - 1];
  const grades = smoothedGrades(points, cumKm);
  const speed = track.pace === "hike" ? hikeKmh : bikeKmh;
  const pending = [...track.breaks].sort((a, b) => a[0] - b[0]);

  const outPoints: Point3[] = [points[0]];
  const t: number[] = [0];
  let clock = 0;
  for (let i = 1; i < points.length; i++) {
    clock += ((cumKm[i] - cumKm[i - 1]) / speed(grades[i])) * 3600;
    outPoints.push(points[i]);
    t.push(Math.round(clock));
    // A pause is the same place, written again after the pause: the logger
    // kept running, the traveller did not move.
    while (pending.length > 0 && cumKm[i] / total >= pending[0][0]) {
      const [, minutes] = pending.shift()!;
      clock += minutes * 60;
      outPoints.push(points[i]);
      t.push(Math.round(clock));
    }
  }
  return { points: outPoints, t };
}

async function generateTracks(): Promise<Record<string, StoredTrack>> {
  const tracks: Record<string, StoredTrack> = {};
  for (const tour of TOURS) {
    for (const track of tour.tracks) {
      const raw = await routeTrail(track, tour.profile);
      const dense = densify(raw, MAX_SPACING_M[track.pace]);
      const timed = timestamps(dense, track);
      tracks[track.key] = {
        p: encodePolyline(timed.points.map(([lon, lat]) => [round5(lon), round5(lat)])),
        e: timed.points.map(([, , ele]) => Math.round(ele)),
        t: timed.t,
      };
      const km = lineKm(timed.points.map(([lon, lat]) => [lon, lat]));
      process.stdout.write(
        `  ${track.key}: ${timed.points.length} points, ${km.toFixed(1)} km, ` +
          `${(timed.t[timed.t.length - 1] / 3600).toFixed(1)} h\n`
      );
    }
  }
  return tracks;
}

async function main(): Promise<void> {
  fs.mkdirSync(GEOMETRY_DIR, { recursive: true });
  process.stdout.write("Roadtrip legs (OSRM car)...\n");
  writeGeometryFile(LEGS_FILE, { ...(await generateLegs()) }, GEOMETRY_DIR);
  process.stdout.write("Recorded tracks (BRouter)...\n");
  writeGeometryFile(TRACKS_FILE, { ...(await generateTracks()) }, GEOMETRY_DIR);
  for (const file of [LEGS_FILE, TRACKS_FILE]) {
    const size = fs.statSync(path.join(GEOMETRY_DIR, file)).size;
    process.stdout.write(`${file}: ${(size / 1024).toFixed(0)} KiB\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
