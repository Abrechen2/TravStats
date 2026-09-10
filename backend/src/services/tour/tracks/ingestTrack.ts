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
  /**
   * Where each recording segment starts inside `geometry`. Always begins at 0.
   * Carried through simplification so the gaps stay gaps — see `parseGpx`.
   */
  segmentStarts: number[];
  /**
   * Raw distance in kilometres at each vertex of `geometry`, from the start.
   *
   * The stored line is simplified, and every dropped vertex is a chord cutting
   * a corner — so re-measuring it gives a shorter answer than the raw track.
   * A leg adopting the WHOLE track came out 7% short of the number shown right
   * beside it on the track itself, and no partial adoption could do better,
   * because the raw measurement was gone (audit finding AUD-034). Keeping the
   * running raw total against each retained vertex means any sub-range is a
   * subtraction, exact against the raw points, and a full adoption returns
   * `distanceKm` itself.
   *
   * A step ACROSS a segment boundary adds nothing: the gap was not travelled.
   */
  cumulativeKm: number[];
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

/**
 * A zero, negative, or non-finite tolerance would defeat the doubling loop
 * in `simplifyWithinCap` (`0 * TOLERANCE_GROWTH_FACTOR` is still `0`), so any
 * value that isn't a genuine positive number is rejected in favour of the
 * default — checked on the value itself (`Number.isFinite` + `> 0`), never
 * via a comparison that a `NaN` could silently lose.
 */
function resolveToleranceDeg(toleranceDeg: number | undefined): number {
  if (toleranceDeg === undefined) return DEFAULT_TOLERANCE_DEG;
  return Number.isFinite(toleranceDeg) && toleranceDeg > 0 ? toleranceDeg : DEFAULT_TOLERANCE_DEG;
}

export function ingestTrack(
  parsed: ParsedTrack,
  opts?: { toleranceDeg?: number; maxPoints?: number }
): IngestedTrack | null {
  if (parsed.startedAt === null || parsed.endedAt === null) return null;
  // The shared minimum: a "track" with fewer than two points cannot be a
  // line — `polylineDistanceKm` measures 0 for it, `adoptSegment` refuses it
  // below two points, and it can never cover a leg. `parseGpx` already
  // enforces this for its own callers (kept as-is, so its own tests and
  // "unreadable file" message stay unchanged); this is the second, SHARED
  // enforcement so the Dawarich pull — which builds a `ParsedTrack` directly
  // and never goes through `parseGpx` — obeys the same rule instead of
  // storing a 1-point "LineString".
  if (parsed.points.length < 2) return null;

  const toleranceDeg = resolveToleranceDeg(opts?.toleranceDeg);
  const maxPoints = opts?.maxPoints ?? DEFAULT_MAX_POINTS;

  const bounds = segmentBounds(parsed.points.length, parsed.segmentStarts);

  // Measure on the raw points BEFORE simplification — see module docstring —
  // and per segment, so the un-recorded gap between two of them is not counted
  // as distance travelled.
  const pointCount = parsed.points.length;
  const rawCumulative = cumulativeRawKm(parsed.points, bounds);
  const distanceKm = rawCumulative[rawCumulative.length - 1] ?? 0;

  // Each segment is simplified on its own. Simplifying the flattened list
  // would let Douglas-Peucker drop the vertices either side of a gap, which
  // is the one place the line must keep its shape exactly.
  const geometry: Array<[number, number]> = [];
  const segmentStarts: number[] = [];
  const cumulativeKm: number[] = [];
  const perSegmentCap = Math.max(2, Math.floor(maxPoints / bounds.length));

  for (const [start, end] of bounds) {
    const raw = parsed.points.slice(start, end);
    const simplified = simplifyWithinCap(raw, toleranceDeg, perSegmentCap);
    const keptIndices = indicesOf(raw, simplified);

    segmentStarts.push(geometry.length);
    for (let i = 0; i < simplified.length; i++) {
      geometry.push(simplified[i]);
      cumulativeKm.push(rawCumulative[start + keptIndices[i]]);
    }
  }

  return {
    geometry,
    segmentStarts,
    cumulativeKm,
    pointCount,
    distanceKm,
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt,
  };
}

/**
 * `[start, end)` index pairs, one per recording segment.
 *
 * Tolerant of a missing or malformed list even though the type requires one:
 * `ParsedTrack` is also built by hand in tests and could be built by a future
 * source that has no notion of segments, and the safe reading of "no
 * boundaries" is one continuous recording — which is what the code did before
 * boundaries existed at all.
 */
function segmentBounds(total: number, starts: number[] | undefined): Array<[number, number]> {
  const usable = Array.isArray(starts) ? starts : [];
  const cleaned = [...new Set(usable.filter((i) => Number.isInteger(i) && i >= 0 && i < total))].sort(
    (a, b) => a - b
  );
  if (cleaned.length === 0 || cleaned[0] !== 0) cleaned.unshift(0);

  const bounds: Array<[number, number]> = [];
  for (let i = 0; i < cleaned.length; i++) {
    const end = i + 1 < cleaned.length ? cleaned[i + 1] : total;
    // A one-point segment carries no distance but still holds its place, so it
    // is kept rather than merged into its neighbour.
    if (end > cleaned[i]) bounds.push([cleaned[i], end]);
  }
  return bounds;
}

/**
 * Running raw distance at every point, with segment boundaries contributing 0.
 * The last entry is the track's total.
 */
function cumulativeRawKm(
  points: ReadonlyArray<[number, number]>,
  bounds: ReadonlyArray<[number, number]>
): number[] {
  const cumulative = new Array<number>(points.length).fill(0);
  let total = 0;
  for (const [start, end] of bounds) {
    // The first point of a segment inherits the total so far — the jump to it
    // is the gap, and the gap was not travelled.
    for (let i = start; i < end; i++) {
      if (i > start) total += polylineDistanceKm([points[i - 1], points[i]]);
      cumulative[i] = total;
    }
  }
  return cumulative;
}

/**
 * Where each simplified point sits in the raw list.
 *
 * Douglas-Peucker returns a SUBSEQUENCE of its input, so a single forward walk
 * finds them all. Coordinates are compared by value rather than by reference
 * because the simplifier is free to hand back copies.
 */
function indicesOf(
  raw: ReadonlyArray<[number, number]>,
  simplified: ReadonlyArray<[number, number]>
): number[] {
  const indices: number[] = [];
  let cursor = 0;
  for (const point of simplified) {
    while (cursor < raw.length && (raw[cursor][0] !== point[0] || raw[cursor][1] !== point[1])) {
      cursor++;
    }
    // A point the walk cannot place (a simplifier that interpolates rather
    // than selects) falls back to the last index found, which keeps the
    // cumulative array monotonic instead of producing a negative sub-range.
    indices.push(cursor < raw.length ? cursor : (indices[indices.length - 1] ?? 0));
    cursor = Math.min(cursor + 1, raw.length);
  }
  return indices;
}
