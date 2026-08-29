import { haversineKm } from "../../../shared/geo/haversine";
import logger from "../../../utils/logger";
import { Coord, LegMode, legDistanceKm } from "../tourDistance";
import { isRoutableMode, RouteProvider, RouteResult } from "./types";

/**
 * Result of routing (or deliberately not routing) a single leg.
 *
 * `waypoints` is `null` for a straight fallback — there is no drawn line to
 * show, only the two stops and a chord between them. `source`/`confidence`
 * are the persisted signal the rest of the app (map layer, legend, "this
 * distance is a rough estimate" badge) reads to know which case it is in.
 */
export interface RoutedLeg {
  waypoints: Array<[number, number]> | null;
  distanceKm: number;
  source: "routed" | "straight";
  confidence: "high" | "low";
  drivingMinutes: number | null;
}

/**
 * Same 1 km anchor tolerance the hand-drawn override path enforces in
 * `routes/trips/tourLegs.ts` (`ANCHOR_TOLERANCE_KM`). Kept as a separate
 * constant rather than a shared import because the two call sites answer
 * different questions with the same number: that route validates a HUMAN's
 * drawn line against the stops it claims to connect; this one validates a
 * PROVIDER's returned line the same way. Duplicating a single small
 * constant is cheaper than coupling an HTTP route module to a routing
 * service module for one shared literal.
 */
const ANCHOR_TOLERANCE_KM = 1;

/**
 * How much longer than the straight-line chord a routed distance is allowed
 * to be before it is treated as a broken provider response rather than a
 * real road.
 *
 * DECISION (required by task-5 brief): a sanity bound IS added, set to a
 * generous 20x the chord. Reasoning:
 *   - Real detours (a fjord, a mountain pass, a lake with one bridge, a
 *     one-way system around a short leg) can legitimately put a road
 *     distance at several times — even ten-ish times — the chord. A tight
 *     bound would reject correct answers and replace them with a *less*
 *     accurate straight-line guess, which is the wrong trade for the exact
 *     case (short legs near difficult geography) where a router earns its
 *     keep the most.
 *   - A response at 50x the chord (the brief's example) is not "an unusual
 *     but real road" in any tour-routing context (legs connect trip stops,
 *     not neighbouring driveways) — it is a symptom of something actually
 *     broken: a unit mismatch, a self-intersecting/looping polyline, or a
 *     provider bug that returns a route for a different query. Trusting
 *     that number verbatim is exactly the "plausible number that is
 *     silently wrong" failure this whole module exists to prevent, so it
 *     is rejected the same way an off-anchor line is.
 *   - The anchor check (above) already catches the "answered about a
 *     different place" case even when the reported distance looks
 *     reasonable; this bound catches the complementary case: anchors line
 *     up, but the reported length does not.
 *   - Only applied when the chord is non-trivial (see MIN_CHORD_FOR_SANITY_KM)
 *     so a very short leg — where any detour looks like a huge ratio purely
 *     from a tiny denominator — is not rejected on ratio alone.
 */
const SANITY_RATIO = 20;

/** Below this chord length, a ratio-based sanity check is not meaningful. */
const MIN_CHORD_FOR_SANITY_KM = 0.5;

interface StraightFallbackArgs {
  from: Coord;
  to: Coord;
}

function straightFallback({ from, to }: StraightFallbackArgs): RoutedLeg {
  return {
    waypoints: null,
    distanceKm: legDistanceKm({ source: "straight", from, to }),
    source: "straight",
    confidence: "low",
    drivingMinutes: null,
  };
}

function toCoord([lon, lat]: [number, number]): Coord {
  return { lat, lon };
}

/**
 * Whether a provider's returned line can be trusted as an answer to the leg
 * that was actually asked about, rather than discarded as a wrong-place or
 * wrong-magnitude response.
 */
function isTrustworthy(result: RouteResult, from: Coord, to: Coord, chordKm: number): boolean {
  const line = result.waypoints;
  if (line.length < 2) {
    logger.warn(
      { waypointCount: line.length },
      "routing provider returned fewer than two waypoints; falling back to straight line",
    );
    return false;
  }

  const head = toCoord(line[0]);
  const tail = toCoord(line[line.length - 1]);
  const headOff = haversineKm(head, from);
  const tailOff = haversineKm(tail, to);
  if (headOff > ANCHOR_TOLERANCE_KM || tailOff > ANCHOR_TOLERANCE_KM) {
    logger.warn(
      { headOffKm: headOff, tailOffKm: tailOff, toleranceKm: ANCHOR_TOLERANCE_KM },
      "routing provider's line does not anchor at the requested stops; falling back to straight line",
    );
    return false;
  }

  if (chordKm >= MIN_CHORD_FOR_SANITY_KM && result.distanceKm > chordKm * SANITY_RATIO) {
    logger.warn(
      { distanceKm: result.distanceKm, chordKm, ratio: result.distanceKm / chordKm },
      "routing provider's distance is implausible relative to the straight-line chord; falling back to straight line",
    );
    return false;
  }

  return true;
}

/**
 * Routes one leg between two stops, applying the fallback rule that governs
 * every kilometre this feature reports:
 *
 *  1. A ferry or rail leg is never sent to a road router — `isRoutableMode`
 *     gates the call itself, before `provider` is even consulted.
 *  2. No provider configured (`provider === null`) → straight chord.
 *  3. The provider answers `null` (its own contract: never throws, `null`
 *     means "could not route this") → straight chord.
 *  4. The provider answers with a line, but that line does not anchor at
 *     the requested stops, or its distance is implausible relative to the
 *     chord → the answer is discarded, straight chord.
 *  5. Otherwise the provider's own line and distance are trusted verbatim —
 *     never recomputed from the polyline, because the provider's distance
 *     reflects the road network, not a geometric measurement of its own
 *     returned points.
 *
 * Every path returns a value; this function never throws for a routing
 * failure (a non-finite input coordinate is a caller bug at the system
 * boundary and is left to `legDistanceKm`'s own throw).
 */
export async function routeLegGeometry(
  provider: RouteProvider | null,
  input: { from: Coord; to: Coord; mode: LegMode },
): Promise<RoutedLeg> {
  const { from, to, mode } = input;

  if (!isRoutableMode(mode) || provider === null) {
    return straightFallback({ from, to });
  }

  const result = await provider.route({ from, to, mode });
  if (result === null) {
    return straightFallback({ from, to });
  }

  const chordKm = haversineKm(from, to);
  if (!isTrustworthy(result, from, to, chordKm)) {
    return straightFallback({ from, to });
  }

  return {
    waypoints: result.waypoints,
    distanceKm: result.distanceKm,
    source: "routed",
    confidence: "high",
    drivingMinutes: result.drivingMinutes,
  };
}
