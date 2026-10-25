/**
 * Movement the logbook may lack (TravTrack plan E7): the runs of a TravTrack
 * derivation read that travel somewhere, between the stays E3's detector
 * finds. Pure — no database, no clock.
 *
 * A run is the stretch of fixes between two stays, or between a stay and a
 * silence (no fix for `JOURNEY_GAP_MS`) — a journey that ends at home ends in
 * silence, because a privacy zone around home keeps every fix inside it off
 * the server. It counts when it has at least `MIN_POINTS` fixes, travels at
 * least `MIN_KM` along its PRIVACY-CUT line, moves at a median ground speed of
 * 15–300 km/h, and holds no fix inside a flight window. A run touching the
 * read's edge is not judged: its start or end lies outside what was read.
 *
 * Privacy: the line, the distance and both ends are taken from the run after
 * `privacyCutBy` (T5) — a chord that crosses a zone is not drawn and not
 * measured, and no end lies inside a circle. An end that was not followed by
 * a stay is "not recorded"; the card says so without saying why. The line is
 * thinned to `LINE_MAX_VERTICES` and cut again on that final form.
 */
import { distanceM, type ZoneCircle } from "../../travtrack/classify";
import { privacyCutBy, type LonLat } from "../../travtrack/privacyCut";
import { detectStays } from "../../dawarich/stays/detect";
import type { DerivationPoint } from "../derivationRead";
import { toDetectorInput } from "../toDetectorInput";

/** No fix for longer than this ends a run (the stay detector's own gap). */
export const JOURNEY_GAP_MS = 30 * 60_000;
export const MIN_POINTS = 10;
export const MIN_KM = 20;
export const MIN_MEDIAN_KMH = 15;
export const MAX_MEDIAN_KMH = 300;
/** The stored line's vertices, all pieces together. */
export const LINE_MAX_VERTICES = 200;
/** At this 85th-percentile speed the profile reads like a train. */
const RAIL_P85_KMH = 160;
/** At or below this median the profile reads like a road. */
const ROAD_MEDIAN_KMH = 110;

export type ModeHint = "rail" | "road" | "unknown";

export type MovementRun = {
  /** The first and last visible fix. */
  fromMs: number;
  untilMs: number;
  /** The observation key of the run's first fix — the journey key's anchor. Server-side only. */
  firstKey: string;
  /** Digests of every fix of the run. Sensitive: never in a response, an export or a log. */
  digests: string[];
  pointCount: number;
  /** Along the privacy-cut line. */
  km: number;
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  /** The run began after a stay, not out of silence or behind a zone. */
  startRecorded: boolean;
  endRecorded: boolean;
  /** Privacy-cut on its final, thinned form; at most `LINE_MAX_VERTICES` vertices. */
  line: LonLat[][];
  medianKmh: number;
  /** From the speed profile only — a hint for the form it opens, never a decision. */
  modeHint: ModeHint;
};

export type MovementOptions = {
  /** The read's window: a run within `JOURNEY_GAP_MS` of either edge is not judged. */
  readFromMs: number;
  readUntilMs: number;
  /** The privacy circles that apply to the read (zones in force and former zones). */
  circles: readonly ZoneCircle[];
};

type Bound = "stay" | "gap" | "edge";
type Segment = { points: DerivationPoint[]; startBound: Bound; endBound: Bound };

const coord = (p: DerivationPoint): LonLat => [p.lon, p.lat];

/** The read's points split into stretches outside every stay, at each silence. */
function segments(points: readonly DerivationPoint[], opts: MovementOptions): Segment[] {
  const stays = detectStays(points.filter((p) => !p.inFlight).map(toDetectorInput));
  const inStay = (t: number) =>
    stays.some((s) => t >= s.startAt.getTime() && t <= s.endAt.getTime());
  const out: Segment[] = [];
  let current: Segment | null = null;
  let previous: DerivationPoint | null = null;
  const close = (endBound: Bound) => {
    if (current) out.push({ ...current, endBound });
    current = null;
  };
  for (const p of points) {
    const silent = previous !== null && p.atMs - previous.atMs > JOURNEY_GAP_MS;
    if (inStay(p.atMs)) {
      close(silent ? "gap" : "stay");
    } else {
      if (current && silent) close("gap");
      if (!current) {
        const startBound: Bound =
          previous === null
            ? p.atMs - opts.readFromMs > JOURNEY_GAP_MS
              ? "gap"
              : "edge"
            : silent
              ? "gap"
              : "stay";
        current = { points: [], startBound, endBound: "edge" };
      }
      current.points.push(p);
    }
    previous = p;
  }
  if (current !== null && previous !== null) {
    close(opts.readUntilMs - (previous as DerivationPoint).atMs > JOURNEY_GAP_MS ? "gap" : "edge");
  }
  return out;
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Ground speeds between consecutive fixes, km/h, ascending. */
function speeds(points: readonly DerivationPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const dt = points[i].atMs - points[i - 1].atMs;
    if (dt > 0) out.push((distanceM(points[i - 1], points[i]) / dt) * 3_600);
  }
  return out.sort((a, b) => a - b);
}

function modeHintOf(sortedKmh: readonly number[]): ModeHint {
  if (percentile(sortedKmh, 0.85) >= RAIL_P85_KMH) return "rail";
  if (percentile(sortedKmh, 0.5) <= ROAD_MEDIAN_KMH) return "road";
  return "unknown";
}

const lengthKm = (pieces: readonly DerivationPoint[][]): number =>
  pieces.reduce(
    (km, piece) => km + piece.slice(1).reduce((m, p, i) => m + distanceM(piece[i], p), 0) / 1_000,
    0
  );

/** Every `step`-th vertex of each piece, its ends always kept. */
function thin(pieces: readonly DerivationPoint[][], step: number): DerivationPoint[][] {
  return pieces.map((piece) =>
    piece.filter((_, i) => i === 0 || i === piece.length - 1 || i % step === 0)
  );
}

/** Thinning rounds before the line is cut down to fit; each round doubles the step. */
const MAX_THIN_ROUNDS = 12;

const vertexCount = (pieces: readonly unknown[][]) => pieces.reduce((n, p) => n + p.length, 0);

/**
 * At most `LINE_MAX_VERTICES / 2` pieces — every piece keeps both its ends, so
 * more could never fit. The longest stay (ties: the earlier), in time order.
 */
function fewestPieces(pieces: DerivationPoint[][]): DerivationPoint[][] {
  const max = Math.floor(LINE_MAX_VERTICES / 2);
  if (pieces.length <= max) return pieces;
  return pieces
    .map((piece, i) => ({ i, km: lengthKm([piece]) }))
    .sort((a, b) => b.km - a.km || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map(({ i }) => pieces[i]);
}

/**
 * The thinned line, cut again on its final form, within the vertex cap.
 * Bounded: the step doubles a fixed number of times; a line that still does
 * not fit (the final cut split it further) keeps its pieces in order while
 * they fit. Never loops on a line it cannot shrink.
 */
function storedLine(all: DerivationPoint[][], circles: readonly ZoneCircle[]): LonLat[][] {
  const pieces = fewestPieces(all);
  let step = Math.max(1, Math.ceil(vertexCount(pieces) / LINE_MAX_VERTICES));
  let line = privacyCutBy(thin(pieces, step), circles, coord);
  for (let round = 0; round < MAX_THIN_ROUNDS && vertexCount(line) > LINE_MAX_VERTICES; round++) {
    step *= 2;
    line = privacyCutBy(thin(pieces, step), circles, coord);
  }
  const kept: DerivationPoint[][] = [];
  let total = 0;
  for (const piece of line) {
    if (total + piece.length > LINE_MAX_VERTICES) break;
    kept.push(piece);
    total += piece.length;
  }
  return kept.map((piece) => piece.map(coord));
}

function judge(segment: Segment, circles: readonly ZoneCircle[]): MovementRun | null {
  const { points } = segment;
  if (segment.startBound === "edge" || segment.endBound === "edge") return null;
  if (points.length < MIN_POINTS || points.some((p) => p.inFlight)) return null;
  const kmh = speeds(points);
  const medianKmh = percentile(kmh, 0.5);
  if (medianKmh < MIN_MEDIAN_KMH || medianKmh > MAX_MEDIAN_KMH) return null;
  const pieces = privacyCutBy([points], circles, coord);
  const km = lengthKm(pieces);
  if (pieces.length === 0 || km < MIN_KM) return null;
  const first = pieces[0][0];
  const lastPiece = pieces[pieces.length - 1];
  const last = lastPiece[lastPiece.length - 1];
  return {
    fromMs: first.atMs,
    untilMs: last.atMs,
    firstKey: points[0].key,
    digests: points.map((p) => p.digest),
    pointCount: points.length,
    km,
    start: { lat: first.lat, lon: first.lon },
    end: { lat: last.lat, lon: last.lon },
    startRecorded: segment.startBound === "stay" && first === points[0],
    endRecorded: segment.endBound === "stay" && last === points[points.length - 1],
    line: storedLine(pieces, circles),
    medianKmh,
    modeHint: modeHintOf(kmh),
  };
}

/** The journeys among a TravTrack derivation read's points (oldest first). */
export function movementRuns(
  points: readonly DerivationPoint[],
  opts: MovementOptions
): MovementRun[] {
  return segments(points, opts)
    .map((segment) => judge(segment, opts.circles))
    .filter((run): run is MovementRun => run !== null);
}
