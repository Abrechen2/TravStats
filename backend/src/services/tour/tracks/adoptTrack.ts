import type { Coord } from "../tourDistance";
import { haversineKm } from "../../../shared/geo/haversine";
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
 * count as covering it, in kilometres. Exported from here (Task 5's own
 * module) rather than duplicated: `routes/trips/tourLegs.ts` already
 * enforces this exact tolerance for a hand-drawn line's anchor points, and
 * imports this constant instead of restating the number, so the two
 * checks can never drift apart.
 */
export const ANCHOR_TOLERANCE_KM = 1;

export interface AdoptionResult {
  /** `[[lon, lat], …]`, from the leg's `from` stop to its `to` stop. */
  waypoints: Array<[number, number]>;
  /** Measured on the ADOPTED SEGMENT, never inherited from the whole track. */
  distanceKm: number;
}

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
  opts?: { maxAnchorKm?: number },
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

  return {
    waypoints,
    // Measured on the adopted segment, NOT the whole track — the track
    // may run for hours before and after this leg's two stops.
    distanceKm: polylineDistanceKm(waypoints),
  };
}
