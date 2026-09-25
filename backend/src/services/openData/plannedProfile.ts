import { createHash } from "crypto";

import { haversineKm } from "../../shared/geo/haversine";
import { climbAndDescent, elevationProfile } from "../tour/tracks/trackMetrics";
import { elevationsFor } from "./openMeteo";

/**
 * The elevation profile of a tour that has not been walked yet: its planned
 * line (routed legs, or the straight chords where a leg is not routed),
 * sampled evenly along its length, with the ground height of each sample from
 * Open-Meteo's elevation service.
 *
 * Read by the same climb rule a recording gets (`climbAndDescent`), so a
 * planned figure and a walked one are comparable. It is the ground, not a
 * GPS: a bridge or a tunnel reads as the valley or the mountain under it.
 */

/** Two elevation requests at most; enough for a readable profile of a day's tour. */
const MAX_SAMPLES = 200;

export interface PlannedProfile {
  distanceKm: number;
  ascentM: number | null;
  descentM: number | null;
  /** `[km, m]` pairs, like a recording's `elevationProfile`. */
  profile: Array<[number, number]>;
}

type Lon = number;
type Lat = number;
type Point = [Lon, Lat];

/** The legs joined into one path, dropping the joint point each leg repeats. */
export function joinLegs(lines: ReadonlyArray<ReadonlyArray<Point>>): Point[] {
  const path: Point[] = [];
  for (const line of lines) {
    const last = path[path.length - 1];
    const joint = last && line[0] && last[0] === line[0][0] && last[1] === line[0][1];
    path.push(...(joint ? line.slice(1) : line));
  }
  return path;
}

const km = (a: Point, b: Point): number =>
  haversineKm({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] });

/** `count` points at equal distances along `path`, with the km at which each lies. */
export function sampleEvenly(
  path: ReadonlyArray<Point>,
  count: number
): { points: Point[]; atKm: number[]; totalKm: number } {
  // A plain loop, not a spreading reduce: a routed leg carries thousands of
  // points, and copying the array per point made this quadratic.
  const cumulative: number[] = new Array<number>(path.length);
  for (let i = 0; i < path.length; i++) {
    cumulative[i] = i === 0 ? 0 : cumulative[i - 1] + km(path[i - 1], path[i]);
  }
  const totalKm = cumulative[cumulative.length - 1] ?? 0;
  const atKm = Array.from({ length: count }, (_, i) => (totalKm * i) / (count - 1));
  let seg = 0;
  const points = atKm.map((target): Point => {
    while (seg < path.length - 2 && cumulative[seg + 1] < target) seg++;
    const span = cumulative[seg + 1] - cumulative[seg];
    const t = span > 0 ? (target - cumulative[seg]) / span : 0;
    const [a, b] = [path[seg], path[seg + 1]];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  });
  return { points, atKm, totalKm };
}

const cache = new Map<string, PlannedProfile | null>();
const MAX_CACHED = 200;

/**
 * The planned profile, or null when the line is too short to have one or
 * the elevation service did not answer. Cached by the line itself, so an
 * edited tour is measured again and an unchanged one is not.
 */
export async function plannedElevationProfile(
  lines: ReadonlyArray<ReadonlyArray<Point>>
): Promise<PlannedProfile | null> {
  const path = joinLegs(lines);
  if (path.length < 2) return null;
  const key = createHash("sha1").update(JSON.stringify(path)).digest("hex");
  if (cache.has(key)) return cache.get(key) ?? null;

  const { points, atKm, totalKm } = sampleEvenly(
    path,
    Math.min(MAX_SAMPLES, Math.max(2, path.length * 4))
  );
  if (totalKm <= 0) return null;
  const heights = await elevationsFor(points);
  if (heights === null) return null; // not cached: the next view may get an answer

  const profile = elevationProfile(atKm, heights);
  const climb = climbAndDescent(heights);
  const result: PlannedProfile | null = profile
    ? {
        distanceKm: Math.round(totalKm * 100) / 100,
        ascentM: climb?.ascentM ?? null,
        descentM: climb?.descentM ?? null,
        profile,
      }
    : null;
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, result);
  return result;
}
