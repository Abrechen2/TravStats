import { haversineKm } from "../../shared/geo/haversine";
import { ANCHOR_TOLERANCE_KM } from "../../shared/tour/anchorTolerance";
import { adoptSegment } from "../tour/tracks/adoptTrack";
import { polylineDistanceKm } from "../cruiseDistance/polylineDistance";
import type { StoredTrack } from "./storedTrack";
import { densifyTrack, type DenseTrack } from "./densifyTrack";

/**
 * Does a recorded track cover a leg — decided HERE, on the server, for tours
 * and for cruises alike (board item `tour-track-coverage-server-side`).
 *
 * Until 2.7 the tour editor answered this in the browser
 * (`frontend/src/lib/trackCoverage.ts`) with its own copy of the 1 km anchor
 * tolerance, fetching the full geometry of every track to do it. Two copies of
 * a rule drift, and when they did the UI would offer `track` on a leg the
 * server then refused, with both test suites green. The frontend now only
 * displays the verdict this module returns.
 *
 * ONE vocabulary, TWO policies. A tour and a cruise ask the same question of
 * different data, and the honest answers differ:
 *
 * - A tour stop is where the traveller actually stood, so the recording must
 *   pass within `ANCHOR_TOLERANCE_KM` (1 km) of both stops, may run either way
 *   (a return leg on a loop), and must not cross an unrecorded stretch — the
 *   adoption refuses that with a 409 (AUD-033), so coverage must too. The tour
 *   verdict is therefore `adoptSegment` itself: the rule that decides the 409
 *   is the rule that decides the offer.
 * - A cruise port is a catalogue coordinate, often the town rather than the
 *   berth, and ships anchor off tender ports three to five kilometres out. The
 *   1 km tour tolerance would refuse nearly every real cruise recording
 *   (board item `cruise-tracks`, point 2). And a phone at sea loses signal for
 *   hours, so a cruise recording almost always has holes; the ship kept
 *   moving through them, which a hike's gap does not promise. So a cruise leg
 *   BRIDGES short holes with a chord and counts the chord as sailed, and only
 *   refuses a leg whose holes make up too much of it.
 */

export const LEG_COVERAGE_STATUSES = ["covered", "coveredWithGaps", "notCovered"] as const;
export type LegCoverageStatus = (typeof LEG_COVERAGE_STATUSES)[number];

/**
 * - `complete` — recorded end to end.
 * - `bridgedGaps` — recorded with holes, each bridged by a chord (cruise only).
 * - `recordingGap` — the recording stops and restarts between the stops (tour).
 * - `tooManyGaps` — holes are more than `CRUISE_MAX_GAP_SHARE` of the leg.
 * - `missesFrom` — never near the leg's start: the recording began mid-leg.
 * - `missesTo` — never near the leg's end: the recording stopped mid-leg.
 * - `missesBoth` — about somewhere else entirely.
 */
export const LEG_COVERAGE_REASONS = [
  "complete",
  "bridgedGaps",
  "recordingGap",
  "tooManyGaps",
  "missesFrom",
  "missesTo",
  "missesBoth",
] as const;
export type LegCoverageReason = (typeof LEG_COVERAGE_REASONS)[number];

/**
 * How useful a verdict is to show, lower first, when several recordings answer
 * for the same leg. "Too many holes" says the recording DOES run through the
 * leg; "misses both ends" says it is about somewhere else entirely.
 */
export const COVERAGE_REASON_RANK: Readonly<Record<LegCoverageReason, number>> = {
  complete: 0,
  bridgedGaps: 0,
  tooManyGaps: 1,
  recordingGap: 1,
  missesFrom: 2,
  missesTo: 2,
  missesBoth: 3,
};

export interface LegSlice {
  /** `[[lon, lat], …]` from the leg's start to its end. */
  waypoints: Array<[number, number]>;
  /** Recorded distance plus the chords across any bridged holes. */
  distanceKm: number;
  /** The part of `distanceKm` that is a chord across a hole, not a recording. */
  gapKm: number;
}

export interface LegCoverage {
  status: LegCoverageStatus;
  reason: LegCoverageReason;
  /** Present exactly when `status` is not `notCovered`. */
  slice: LegSlice | null;
}

export interface Coord {
  lat: number;
  lon: number;
}

/**
 * How far a cruise port may sit from the nearest point of a recording and
 * still count as reached. Ten kilometres covers an anchorage off a tender port
 * (three to five kilometres out) plus a catalogue coordinate that names the
 * town rather than the terminal — Civitavecchia is catalogued as the port, but
 * plenty of ports are the city centre. It is still far too tight to let a
 * recording of a different coast pass.
 */
export const CRUISE_TRACK_ANCHOR_KM = 10;

/**
 * Two consecutive recorded points further apart than this are a hole, not a
 * recording. A GPS logger at one point a minute on a ship at 22 knots steps
 * 0.7 km; twenty kilometres of silence is a phone that lost its signal.
 * Applied at import (`splitAtLongSteps`), so the hole becomes a segment
 * boundary like any file's own `<trkseg>` break.
 */
export const CRUISE_TRACK_GAP_KM = 20;

/**
 * The largest share of a leg that may be a bridged hole before the recording
 * stops being evidence of the route. Above a quarter the line on the map is
 * more guess than measurement, and the schematic sea route is the more honest
 * picture — it at least follows the shipping lanes.
 */
export const CRUISE_MAX_GAP_SHARE = 0.25;

function nearestKm(track: ReadonlyArray<[number, number]>, target: Coord): number {
  let best = Infinity;
  for (const [lon, lat] of track) {
    const km = haversineKm({ lat, lon }, target);
    if (km < best) best = km;
  }
  return best;
}

function missReason(fromReached: boolean, toReached: boolean): LegCoverageReason {
  if (!fromReached && !toReached) return "missesBoth";
  return fromReached ? "missesTo" : "missesFrom";
}

const NOT_COVERED = (reason: LegCoverageReason): LegCoverage => ({
  status: "notCovered",
  reason,
  slice: null,
});

/**
 * The tour verdict: exactly `adoptSegment`'s acceptance, so the editor offers
 * `track` on a leg if and only if `PUT …/legs/…` with `source: "track"` would
 * store it.
 */
export function tourLegCoverage(track: StoredTrack, from: Coord, to: Coord): LegCoverage {
  const adoption = adoptSegment(track.geometry, from, to, {
    maxAnchorKm: ANCHOR_TOLERANCE_KM,
    cumulativeKm: track.cumulativeKm,
    segmentStarts: track.segmentStarts,
  });
  if (adoption === null) {
    return NOT_COVERED(
      missReason(
        nearestKm(track.geometry, from) <= ANCHOR_TOLERANCE_KM,
        nearestKm(track.geometry, to) <= ANCHOR_TOLERANCE_KM
      )
    );
  }
  if (adoption.spansRecordingGap) return NOT_COVERED("recordingGap");
  return {
    status: "covered",
    reason: "complete",
    slice: { waypoints: adoption.waypoints, distanceKm: adoption.distanceKm, gapKm: 0 },
  };
}

type Label = "from" | "to" | null;

/**
 * Which of the two ports a recorded point is AT, if either. A point within
 * reach of both (a short hop between neighbouring ports) belongs to the nearer
 * one, so the two ends of a leg never claim the same point.
 */
function labelPoint(point: [number, number], from: Coord, to: Coord, anchorKm: number): Label {
  const at = { lat: point[1], lon: point[0] };
  const dFrom = haversineKm(at, from);
  const dTo = haversineKm(at, to);
  if (dFrom <= anchorKm && dFrom <= dTo) return "from";
  if (dTo <= anchorKm) return "to";
  return null;
}

interface LocatedLeg {
  departIndex: number;
  arriveIndex: number;
}

/**
 * Where one cruise leg sits on a recording, searching from `cursor` onwards.
 *
 * A recording runs forward in time and so does the ship, so the leg is the
 * stretch between LEAVING the departure port and REACHING the arrival port:
 * the first visit to the arrival port that has a visit to the departure port
 * before it, cut from the departure visit's closest approach (its last one —
 * the ship leaves from the berth) to the arrival visit's closest approach (its
 * first one — the ship has arrived). Nearest-point matching alone, as tours
 * use, cuts a round trip wrongly: Kiel → Oslo → Kiel has Kiel at both ends of
 * the recording, and "the point nearest Kiel" is whichever comes first.
 */
function locateCruiseLeg(
  geometry: ReadonlyArray<[number, number]>,
  from: Coord,
  to: Coord,
  cursor: number,
  anchorKm: number
): LocatedLeg | { miss: LegCoverageReason } {
  const labels = geometry.map((p, i) => (i < cursor ? null : labelPoint(p, from, to, anchorKm)));
  let lastFromRunEnd = -1;
  let sawFrom = false;
  let sawTo = false;

  for (let k = cursor; k < geometry.length; k++) {
    if (labels[k] === "from") {
      sawFrom = true;
      lastFromRunEnd = k;
      continue;
    }
    if (labels[k] !== "to") continue;
    sawTo = true;
    if (lastFromRunEnd < 0) continue;

    let runStart = lastFromRunEnd;
    while (runStart - 1 >= cursor && labels[runStart - 1] === "from") runStart--;
    let arriveRunEnd = k;
    while (arriveRunEnd + 1 < geometry.length && labels[arriveRunEnd + 1] === "to") arriveRunEnd++;

    return {
      departIndex: closestIndex(geometry, from, runStart, lastFromRunEnd, "last"),
      arriveIndex: closestIndex(geometry, to, k, arriveRunEnd, "first"),
    };
  }
  // A visit to the arrival port with no departure before it means the
  // recording began after the ship had left — the "track starting mid-leg".
  if (sawTo) return { miss: "missesFrom" };
  return { miss: missReason(sawFrom, false) };
}

function closestIndex(
  geometry: ReadonlyArray<[number, number]>,
  target: Coord,
  lo: number,
  hi: number,
  tie: "first" | "last"
): number {
  let best = lo;
  let bestKm = Infinity;
  for (let i = lo; i <= hi; i++) {
    const km = haversineKm({ lat: geometry[i][1], lon: geometry[i][0] }, target);
    if (km < bestKm || (tie === "last" && km === bestKm)) {
      bestKm = km;
      best = i;
    }
  }
  return best;
}

/** The chords across every segment boundary strictly inside `(lo, hi]`. */
function bridgedGapKm(track: DenseTrack, lo: number, hi: number): number {
  let gap = 0;
  for (const start of track.segmentStarts) {
    if (start > lo && start <= hi) {
      gap += polylineDistanceKm([track.geometry[start - 1], track.geometry[start]]);
    }
  }
  return gap;
}

function measureCruiseSlice(track: DenseTrack, lo: number, hi: number): LegSlice {
  const line = track.geometry.slice(lo, hi + 1);
  const gapKm = bridgedGapKm(track, lo, hi);
  // The raw running total leaves a hole out (it was not recorded); the chord
  // across it is added back because the ship did sail it. Without a running
  // total the simplified line is measured, and it already includes the chord.
  const distanceKm =
    track.cumulativeKm !== null
      ? Math.max(0, track.cumulativeKm[hi] - track.cumulativeKm[lo]) + gapKm
      : polylineDistanceKm(line);
  // The map gets the stored line's own vertices plus the two cut points; the
  // interpolated ones only served to find the ports and lie on it anyway.
  const waypoints = line.filter(
    (_, i) => i === 0 || i === line.length - 1 || track.original[lo + i]
  );
  return { waypoints, distanceKm, gapKm };
}

/**
 * The cruise verdict for every leg of an itinerary against ONE recording.
 *
 * Legs are located in order, each searching only after the previous covered
 * leg's arrival: the recording is a single forward journey, so leg three
 * cannot sit before leg two on it. A leg the recording does not cover leaves
 * the search where it was — a recording that starts in the second port still
 * finds legs two onwards.
 */
export function cruiseLegsCoverage(
  track: StoredTrack,
  legs: ReadonlyArray<{ from: Coord; to: Coord }>,
  opts: { anchorKm?: number; maxGapShare?: number } = {}
): LegCoverage[] {
  const anchorKm = opts.anchorKm ?? CRUISE_TRACK_ANCHOR_KM;
  const maxGapShare = opts.maxGapShare ?? CRUISE_MAX_GAP_SHARE;
  // Half the anchor radius: a line passing a port within reach then always has
  // a vertex within reach too.
  const dense = densifyTrack(track, anchorKm / 2);
  let cursor = 0;

  return legs.map(({ from, to }) => {
    if (dense.geometry.length < 2) return NOT_COVERED("missesBoth");
    const located = locateCruiseLeg(dense.geometry, from, to, cursor, anchorKm);
    if ("miss" in located) return NOT_COVERED(located.miss);

    const slice = measureCruiseSlice(dense, located.departIndex, located.arriveIndex);
    if (slice.waypoints.length < 2) return NOT_COVERED("missesBoth");
    cursor = located.arriveIndex;

    if (slice.gapKm === 0) return { status: "covered", reason: "complete", slice };
    const share = slice.distanceKm > 0 ? slice.gapKm / slice.distanceKm : 1;
    if (share > maxGapShare) return NOT_COVERED("tooManyGaps");
    return { status: "coveredWithGaps", reason: "bridgedGaps", slice };
  });
}

export interface TrackVerdict {
  /** The recording the verdict is about; null when none reaches the leg at all. */
  trackId: string | null;
  status: LegCoverageStatus;
  reason: LegCoverageReason;
}

/**
 * The tour editor's answer for one leg across all of a section's recordings:
 * the FIRST covering one, oldest-started first (the order the tour track list
 * has always used, so the choice is the same one the editor made before), or
 * else the most useful refusal. Null when the section has no recordings.
 */
export function tourLegVerdict(
  tracks: ReadonlyArray<{ id: string; track: StoredTrack }>,
  from: Coord,
  to: Coord
): TrackVerdict | null {
  let best: TrackVerdict | null = null;
  for (const { id, track } of tracks) {
    const coverage = tourLegCoverage(track, from, to);
    if (coverage.status !== "notCovered") {
      return { trackId: id, status: coverage.status, reason: coverage.reason };
    }
    if (
      best === null ||
      COVERAGE_REASON_RANK[coverage.reason] < COVERAGE_REASON_RANK[best.reason]
    ) {
      best = {
        trackId: coverage.reason === "missesBoth" ? null : id,
        status: "notCovered",
        reason: coverage.reason,
      };
    }
  }
  return best;
}
