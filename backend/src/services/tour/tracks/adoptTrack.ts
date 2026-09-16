import type { Coord } from "../tourDistance";
import { haversineKm } from "../../../shared/geo/haversine";
import { ANCHOR_TOLERANCE_KM } from "../../../shared/tour/anchorTolerance";
import { polylineDistanceKm } from "../../cruiseDistance/polylineDistance";

/**
 * Pure "adopt a leg's geometry from a recorded track" step (Phase 3b, task
 * 5). No file system, no database, no network — the endpoint
 * (`routes/trips/tourLegs.ts`) owns loading the track and the leg, and
 * writing the result; this module only decides WHICH slice of the track
 * the leg gets, and how long that slice is.
 *
 * A track is a continuous recording of an entire day (or longer); a leg is
 * one hop between two consecutive stops. Adopting means finding the two
 * points on the track nearest the leg's own stops and cutting between
 * them — never the other way around (stretching the leg's stops onto the
 * track), because the stops are the itinerary's ground truth and the track
 * is raw GPS, not the reverse.
 */

/**
 * How far a track's nearest point may sit from a leg's stop and still
 * count as covering it, in kilometres. Re-exported from here (Task 5's
 * own module, unchanged) so existing importers
 * (`routes/trips/tourLegs.ts`, this module's own test) keep working —
 * the canonical value now lives in `shared/tour/anchorTolerance.ts`,
 * mirrored on the frontend at `frontend/src/shared/tour/anchorTolerance.ts`
 * (the constant `frontend/src/lib/trackCoverage.ts` consumes), with a
 * guard test that fails if the two diverge. See that shared module's own
 * doc comment for the full reasoning.
 */
export { ANCHOR_TOLERANCE_KM };

export interface AdoptionResult {
  /** `[[lon, lat], …]`, from the leg's `from` stop to its `to` stop. */
  waypoints: Array<[number, number]>;
  /** Measured on the ADOPTED SEGMENT, never inherited from the whole track. */
  distanceKm: number;
  /** How that number was arrived at — see `AdoptionBasis`. */
  basis: AdoptionBasis;
  /**
   * True when the adopted slice crosses a boundary between two recording
   * segments — the receiver was off in between, so part of this leg was never
   * recorded. The distance excludes the gap (it was not travelled), but the
   * waypoints run straight across it, and presenting that line as a measured
   * recording would contradict the number beside it. The endpoint refuses
   * these rather than storing a half-measured leg as `confidence: high`.
   */
  spansRecordingGap: boolean;
}

/**
 * Where the adopted slice ends up being measured.
 *
 * `raw` means the track carried a cumulative raw distance and the answer is a
 * subtraction against it — exact, and for a full adoption identical to the
 * track's own `distanceKm`. `simplified` means it did not (a row written
 * before that column existed) and the stored, simplified line was measured
 * instead, which is short by however many corners the simplifier cut.
 */
export type AdoptionBasis = "raw" | "simplified";

/** The index of `track`'s point nearest `target`, and how far away it is. */
function nearestPoint(
  track: ReadonlyArray<[number, number]>,
  target: Coord,
): { index: number; km: number } {
  let bestIndex = 0;
  let bestKm = Infinity;
  for (let i = 0; i < track.length; i++) {
    const [lon, lat] = track[i];
    const km = haversineKm({ lat, lon }, target);
    // Strict "<" — an exact tie keeps the EARLIEST index. A track that
    // passes the same stop twice (a loop: e.g. it starts and ends at the
    // same car park) has two candidate points at effectively the same
    // distance; taking the first occurrence is deterministic and models
    // "the first time the vehicle was here" without needing to reason
    // about which visit the traveller "meant".
    if (km < bestKm) {
      bestKm = km;
      bestIndex = i;
    }
  }
  return { index: bestIndex, km: bestKm };
}

/**
 * Cuts `track` between the points nearest `from` and `to`, and measures
 * that cut. Returns `null` when either stop isn't actually covered by this
 * track (further than `maxAnchorKm` from every point in it) — the track
 * covers a different day or a different place, and stretching it onto
 * this leg would draw a route the traveller never took. The caller is
 * responsible for turning `null` into a 409, never a silent fallback to a
 * straight chord: the user asked for THIS track specifically.
 *
 * Direction always runs `from -> to`, regardless of which way the track
 * itself was recorded: if the track visits `to` before `from` (a return
 * leg on a round trip, say), the cut segment is reversed before being
 * returned. Getting this backwards would silently draw every such leg
 * running the wrong way on the map.
 */
export function adoptSegment(
  track: Array<[number, number]>,
  from: Coord,
  to: Coord,
  opts?: {
    maxAnchorKm?: number;
    /** The track's raw running distance, one entry per point of `track`.
     *  A length mismatch is ignored rather than trusted — see below. */
    cumulativeKm?: number[] | null;
    /** Index into `track` where each recording segment starts. Absent or
     *  malformed reads as one continuous recording, which is what every row
     *  written before the boundaries existed effectively is. */
    segmentStarts?: number[] | null;
  },
): AdoptionResult | null {
  const maxAnchorKm = opts?.maxAnchorKm ?? ANCHOR_TOLERANCE_KM;
  if (track.length < 2) return null;

  const fromNearest = nearestPoint(track, from);
  const toNearest = nearestPoint(track, to);
  if (fromNearest.km > maxAnchorKm || toNearest.km > maxAnchorKm) return null;

  const waypoints =
    fromNearest.index <= toNearest.index
      ? track.slice(fromNearest.index, toNearest.index + 1)
      : track.slice(toNearest.index, fromNearest.index + 1).reverse();

  // Both stops resolved to the SAME track point (or two adjacent points
  // that collapsed to one after the slice above) — not a segment, so not
  // an adoption. This is the null case a single-point track, or a leg
  // whose two stops are the same coordinate, would otherwise hit.
  if (waypoints.length < 2) return null;

  const lo = Math.min(fromNearest.index, toNearest.index);
  const hi = Math.max(fromNearest.index, toNearest.index);
  const cumulative = opts?.cumulativeKm;
  // A subtraction against the RAW running total, when the track has one. The
  // stored line is simplified, and measuring it back gives a shorter answer
  // than the track's own number — a leg adopting the entire track came out
  // 7% under the figure displayed right beside it (AUD-034). Falls back to
  // measuring the line for rows written before the column existed.
  const usable = Array.isArray(cumulative) && cumulative.length === track.length;

  return {
    waypoints,
    // Measured on the adopted segment, NOT the whole track — the track
    // may run for hours before and after this leg's two stops.
    distanceKm: usable ? Math.max(0, cumulative[hi] - cumulative[lo]) : polylineDistanceKm(waypoints),
    basis: usable ? "raw" : "simplified",
    spansRecordingGap: crossesSegmentBoundary(opts?.segmentStarts, lo, hi),
  };
}

/** Whether `[lo, hi]` straddles the start of a later recording segment. */
function crossesSegmentBoundary(
  segmentStarts: number[] | null | undefined,
  lo: number,
  hi: number,
): boolean {
  if (!Array.isArray(segmentStarts)) return false;
  return segmentStarts.some((start) => start > lo && start <= hi);
}
