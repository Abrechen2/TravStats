import { simplifyDegrees } from "../../schematicRouter";
import { polylineDistanceKm } from "../../cruiseDistance/polylineDistance";
import type { ParsedTrack } from "./parseGpx";

/**
 * Pure ingestion step between `parseGpx` (task 2) and the database: takes a
 * `ParsedTrack` and returns what should actually be stored, or `null` when
 * the track cannot be used. No file system, no database, no network.
 *
 * The single rule this module exists to enforce: `distanceKm` is measured on
 * the RAW points, before simplification. Simplifying first and measuring
 * after silently shortens every track — Douglas-Peucker drops vertices, and
 * every dropped vertex is a chord that cuts a corner. The feature only earns
 * its place if the distance is *measured*, not estimated from a simplified
 * line, so `pointCount` and `distanceKm` are both computed from
 * `parsed.points` before `simplifyDegrees` ever runs.
 */

/** JSON-column point cap for the simplified geometry that gets stored. */
const DEFAULT_MAX_POINTS = 2000;

/** Starting Douglas-Peucker tolerance; raised if the cap isn't met yet. */
const DEFAULT_TOLERANCE_DEG = 0.0001;

/** Tolerance growth factor per re-simplify attempt while over the cap. */
const TOLERANCE_GROWTH_FACTOR = 2;

/** Safety bound on re-simplify attempts so a pathological input cannot loop forever. */
const MAX_SIMPLIFY_ATTEMPTS = 30;

export interface IngestedTrack {
  /** Simplified geometry, `[lon, lat]` order, at or below `maxPoints`. */
  geometry: Array<[number, number]>;
  /** Point count of the RAW track (before simplification). */
  pointCount: number;
  /** Distance in kilometres, measured on the RAW track (before simplification). */
  distanceKm: number;
  startedAt: Date;
  endedAt: Date;
}

/**
 * Simplifies `points` down to at most `maxPoints`, by raising the
 * Douglas-Peucker tolerance and re-simplifying rather than truncating —
 * truncation would throw away the end of the journey, which is exactly the
 * failure mode this feature exists to avoid for the raw distance.
 */
function simplifyWithinCap(
  points: ReadonlyArray<[number, number]>,
  toleranceDeg: number,
  maxPoints: number
): [number, number][] {
  let tolerance = toleranceDeg;
  let simplified = simplifyDegrees(points, tolerance);

  for (
    let attempt = 0;
    simplified.length > maxPoints && attempt < MAX_SIMPLIFY_ATTEMPTS;
    attempt++
  ) {
    tolerance *= TOLERANCE_GROWTH_FACTOR;
    simplified = simplifyDegrees(points, tolerance);
  }

  return simplified;
}

export function ingestTrack(
  parsed: ParsedTrack,
  opts?: { toleranceDeg?: number; maxPoints?: number }
): IngestedTrack | null {
  if (parsed.startedAt === null || parsed.endedAt === null) return null;

  const toleranceDeg = opts?.toleranceDeg ?? DEFAULT_TOLERANCE_DEG;
  const maxPoints = opts?.maxPoints ?? DEFAULT_MAX_POINTS;

  // Measure on the raw points BEFORE simplification — see module docstring.
  const pointCount = parsed.points.length;
  const distanceKm = polylineDistanceKm(parsed.points);

  const geometry = simplifyWithinCap(parsed.points, toleranceDeg, maxPoints);

  return {
    geometry,
    pointCount,
    distanceKm,
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt,
  };
}
