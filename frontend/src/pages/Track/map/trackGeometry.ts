import type { TrackPoint, TravTrackDay } from "../../../lib/api/travtrack";

/**
 * The arithmetic of the Track map (TravTrack plan T5.2), on the server's safe
 * stretches only. Every function here works inside ONE segment: the server cut
 * the day at every gap, privacy zone, deletion, pause and flight-mode break,
 * and nothing on this map may reconnect two stretches — not a line, not a
 * speed, not a distance. The client may cut further (`splitAfterPause`), never
 * join.
 */

export type LonLat = [number, number];

const EARTH_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two fixes, in metres. */
export function distanceM(a: TrackPoint, b: TrackPoint): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[2] - a[2]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const lonLat = (p: TrackPoint): LonLat => [p[2], p[1]];

/**
 * Cuts each stretch further wherever two consecutive fixes lie more than
 * `pauseMs` apart. `null` keeps the server's cuts as they are. The result has
 * at least as many stretches as the input, and every pair of neighbours in it
 * was already a pair of neighbours in one input stretch.
 */
export function splitAfterPause(
  segments: readonly TrackPoint[][],
  pauseMs: number | null
): TrackPoint[][] {
  if (pauseMs === null) return segments.map((s) => [...s]);
  return segments.flatMap((segment) => {
    const out: TrackPoint[][] = [];
    let current: TrackPoint[] = [];
    segment.forEach((point, i) => {
      const prev = segment[i - 1];
      if (prev && point[0] - prev[0] > pauseMs) {
        out.push(current);
        current = [];
      }
      current.push(point);
    });
    if (current.length > 0) out.push(current);
    return out;
  });
}

/** One piece of a line between two neighbouring fixes of one stretch, with its speed. */
export interface SpeedPiece {
  path: [LonLat, LonLat];
  /** km/h; null when the two fixes share an instant (no speed can be told). */
  kmh: number | null;
  segment: number;
}

/** The line as pieces coloured by speed — never a piece between two stretches. */
export function speedPieces(segments: readonly TrackPoint[][]): SpeedPiece[] {
  return segments.flatMap((segment, index) =>
    segment.slice(1).map((point, i) => {
      const prev = segment[i];
      const dt = point[0] - prev[0];
      return {
        path: [lonLat(prev), lonLat(point)] as [LonLat, LonLat],
        kmh: dt > 0 ? (distanceM(prev, point) / dt) * 3_600 : null,
        segment: index,
      };
    })
  );
}

type Rgb = [number, number, number];

/** The legend's stops: 0, 30, 120, 300+ km/h. */
export const SPEED_STOPS: ReadonlyArray<{ kmh: number; rgb: Rgb }> = [
  { kmh: 0, rgb: [91, 141, 239] },
  { kmh: 30, rgb: [94, 194, 178] },
  { kmh: 120, rgb: [240, 169, 71] },
  { kmh: 300, rgb: [226, 104, 60] },
];

/** A colour on the legend's ramp; an unknown speed is the ramp's grey. */
export function speedColor(kmh: number | null): Rgb {
  if (kmh === null) return [148, 163, 184];
  const first = SPEED_STOPS[0];
  const last = SPEED_STOPS[SPEED_STOPS.length - 1];
  if (kmh <= first.kmh) return first.rgb;
  if (kmh >= last.kmh) return last.rgb;
  const upper = SPEED_STOPS.findIndex((s) => s.kmh >= kmh);
  const a = SPEED_STOPS[upper - 1];
  const b = SPEED_STOPS[upper];
  const f = (kmh - a.kmh) / (b.kmh - a.kmh);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * f);
  return [mix(a.rgb[0], b.rgb[0]), mix(a.rgb[1], b.rgb[1]), mix(a.rgb[2], b.rgb[2])];
}

/** A pair slower than this is standing, not moving — GPS drift around a chair. */
export const MOVING_KMH = 3;

export interface RangeTotals {
  /** Metres, summed inside stretches only. */
  distanceM: number;
  movingMs: number;
  /** km/h over the moving time; null when nothing moved (an average over nothing is no 0). */
  avgKmh: number | null;
  points: number;
  /** 0..1 of the shown span that was recorded; null when no coverage is known. */
  coverage: number | null;
}

export function rangeTotals(
  segments: readonly TrackPoint[][],
  days: readonly Pick<TravTrackDay, "pointCount" | "coverage">[]
): RangeTotals {
  let distance = 0;
  let movingM = 0;
  let movingMs = 0;
  for (const piece of segments.flatMap((s) =>
    s.slice(1).map((p, i) => [s[i] as TrackPoint, p] as const)
  )) {
    const [a, b] = piece;
    const d = distanceM(a, b);
    const dt = b[0] - a[0];
    distance += d;
    if (dt > 0 && (d / dt) * 3_600 >= MOVING_KMH) {
      movingM += d;
      movingMs += dt;
    }
  }
  let recorded = 0;
  let total = 0;
  for (const piece of days.flatMap((d) => d.coverage)) {
    total += piece.untilMs - piece.fromMs;
    if (piece.state === "recorded") recorded += piece.untilMs - piece.fromMs;
  }
  return {
    distanceM: distance,
    movingMs,
    avgKmh: movingMs > 0 ? (movingM / movingMs) * 3_600 : null,
    points: days.reduce((n, d) => n + d.pointCount, 0),
    coverage: total > 0 ? recorded / total : null,
  };
}

/**
 * The frame around the lines, the margin following their own extent (≥ ~500 m).
 * One loop, never `Math.min(...all)`: a year of vertices overflows the call stack.
 */
export function linesBounds(lines: readonly LonLat[][]): [LonLat, LonLat] | null {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const line of lines) {
    for (const [lon, lat] of line) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  if (west === Infinity) return null;
  const pad = Math.max(0.005, (east - west) / 10, (north - south) / 10);
  return [
    [west - pad, Math.max(-90, south - pad)],
    [east + pad, Math.min(90, north + pad)],
  ];
}
