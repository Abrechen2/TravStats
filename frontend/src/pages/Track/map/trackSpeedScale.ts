import type { TrackPoint } from "../../../lib/api/travtrack";
import type { MaxAccuracyM, SpeedScale } from "../../../lib/webPrefs/trackMap";
import { SPEED_STOPS, speedPieces } from "./trackGeometry";
import type { MapPoint } from "./trackMapLayers";

/**
 * The speed colouring's presets (spec 2026-11-03-travtrack-legs, W3). The
 * ramp's colours never change — only the speeds they sit at — so a legend
 * reads the same in every preset. `auto` fits the ramp to the shown track.
 */
export type SpeedStop = (typeof SPEED_STOPS)[number];

/** The ramp's stops as fractions of its top, so every preset keeps the default's shape. */
const SHAPE = [0, 0.1, 0.4, 1] as const;

/** The top speed (km/h) of each fixed preset; `default` is the original 0…300 ramp. */
const TOP_KMH: Record<Exclude<SpeedScale, "auto">, number> = {
  default: 300,
  walk: 8,
  cycle: 35,
  car: 130,
};

/** The auto scale never goes below this: a track of dwells would otherwise colour GPS drift as fast. */
export const AUTO_MIN_TOP_KMH = 8;

const stopsFor = (top: number): SpeedStop[] =>
  SPEED_STOPS.map((stop, i) => ({ ...stop, kmh: Math.round(top * SHAPE[i] * 10) / 10 }));

/** The speed below which 95 % of the shown pieces lie; null when no piece has a speed. */
export function speedTop(segments: readonly TrackPoint[][]): number | null {
  const speeds = speedPieces(segments)
    .flatMap((p) => (p.kmh === null ? [] : [p.kmh]))
    .sort((a, b) => a - b);
  if (speeds.length === 0) return null;
  return speeds[Math.min(speeds.length - 1, Math.floor(speeds.length * 0.95))];
}

/** Whole km/h, rounded up, so the legend's last label is a number a reader can hold. */
const niceTop = (kmh: number): number => Math.max(AUTO_MIN_TOP_KMH, Math.ceil(kmh));

/**
 * The stops of a preset. `auto` over a track without a single speed falls
 * back to the default ramp rather than inventing a scale.
 */
export function speedStopsFor(scale: SpeedScale, segments: readonly TrackPoint[][]): SpeedStop[] {
  if (scale !== "auto") return stopsFor(TOP_KMH[scale]);
  const top = speedTop(segments);
  return top === null ? stopsFor(TOP_KMH.default) : stopsFor(niceTop(top));
}

/**
 * Points the reader's accuracy limit keeps. A point whose accuracy the phone
 * did not report stays: unknown is not "bad", and dropping it would hide
 * every fix of an import.
 */
export function filterByAccuracy(
  points: readonly MapPoint[],
  maxAccuracyM: MaxAccuracyM
): readonly MapPoint[] {
  if (maxAccuracyM === null) return points;
  return points.filter(({ point }) => point[3] === null || point[3] <= maxAccuracyM);
}
