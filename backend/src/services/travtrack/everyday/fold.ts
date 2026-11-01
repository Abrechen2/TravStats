/**
 * The everyday figures of a stretch of TravTrack history (forgejo#400): top
 * speed, highest point and time and ground kilometres per movement class.
 * Pure — it reads privacy-safe stretches (`readSafe.ts`), so nothing a zone
 * hides is ever in a figure, and it never touches the database or a clock.
 *
 * Every figure abstains: no believable value is null, never 0.
 *
 * ## The spike rule (documented, tested in `everyday.fold.test.ts`)
 *
 * A fix is left out of EVERY figure when it is in the air (a flight window or
 * a point recorded for a flight: the phone's altitude and speed in a cabin are
 * an aircraft's, not an everyday one) or is a bad fix (`isBadFix`).
 *
 * Top speed: the fix's reported `speedMps` after `plausibleSpeedMps`
 * (0–500 km/h, accuracy, the phone's own class), and — above `SPIKE_MIN_MPS`
 * (10 m/s) — it must be corroborated: a neighbouring fix of the same stretch
 * within `CORROBORATE_WITHIN_MS` (120 s) must show at least a fifth of it,
 * reported or as the speed of the step to it — a neighbour that is a bad fix or
 * in the air, or a step faster than 500 km/h, vouches for nothing. A lone 60 m/s among fixes
 * crawling at 1 m/s is a GPS spike and is dropped; a fix with no neighbour
 * that close cannot be corroborated and is dropped too.
 *
 * Highest point: the believable altitudes of a stretch are smoothed by a
 * median over five consecutive fixes (at least three in the window), and the
 * highest smoothed value counts — one spiking altitude cannot be the maximum.
 *
 * Per class: only ground steps (the monthly kilometres' own steps: not in the
 * air, not faster than 500 km/h, no bad fix) of at most `STEP_MAX_MS`
 * (15 min) count, for both time and kilometres, filed under the class the
 * phone reported at the step's later fix. A longer step is a gap in the
 * recording, not time spent walking. These kilometres therefore never exceed,
 * and need not equal, the monthly ground kilometres.
 */
import { isBadFix } from "../../locationEvidence/anomaly";
import type { StoredPoint } from "../../tripRecording/segments";
import { distanceM } from "../classify";
import type { SafePointRow } from "../readSafe";
import { groundSteps, type InFlight } from "../months/values";
import {
  MAX_SPEED_MPS,
  motionClassOf,
  plausibleAltitudeM,
  plausibleSpeedMps,
  type MotionClass,
} from "./plausible";

export const SPIKE_MIN_MPS = 10;
export const CORROBORATE_WITHIN_MS = 120_000;
export const CORROBORATE_FRACTION = 0.2;
export const STEP_MAX_MS = 15 * 60_000;
const MEDIAN_WINDOW = 5;
const MEDIAN_MIN = 3;

export type EverydayFigures = {
  topSpeed: { mps: number; atMs: number } | null;
  highest: { m: number; atMs: number } | null;
  byMotion: Record<MotionClass, { ms: number; km: number }>;
};

export const emptyFigures = (): EverydayFigures => ({
  topSpeed: null,
  highest: null,
  byMotion: Object.fromEntries(
    (["walking", "running", "cycling", "automotive", "stationary", "unknown"] as const).map((c) => [
      c,
      { ms: 0, km: 0 },
    ])
  ) as EverydayFigures["byMotion"],
});

type RowOf = (point: StoredPoint) => SafePointRow | undefined;

const fixOf = (p: StoredPoint) => ({ atMs: p[0], lat: p[1], lon: p[2], accuracyM: p[3] });

/** A fix that may feed a figure at all. */
function usable(
  p: StoredPoint,
  row: SafePointRow | undefined,
  inFlight: InFlight
): row is SafePointRow {
  return row !== undefined && !inFlight(p) && row.purpose !== "flight" && !isBadFix(fixOf(p));
}

/** The highest believable speed of a stretch that survives the spike rule. */
function topSpeedOf(
  stretch: readonly StoredPoint[],
  rowOf: RowOf,
  inFlight: InFlight
): { mps: number; atMs: number } | null {
  const ok = stretch.map((p) => usable(p, rowOf(p), inFlight));
  const reported = stretch.map((p, i) => {
    const row = rowOf(p);
    return ok[i] && row ? plausibleSpeedMps(row) : null;
  });
  let best: { mps: number; atMs: number } | null = null;
  for (let i = 0; i < stretch.length; i++) {
    const s = reported[i];
    if (s === null || (best !== null && s <= best.mps)) continue;
    if (s > SPIKE_MIN_MPS && !corroborated(stretch, reported, ok, i)) continue;
    best = { mps: s, atMs: stretch[i][0] };
  }
  return best;
}

function corroborated(
  stretch: readonly StoredPoint[],
  reported: readonly (number | null)[],
  ok: readonly boolean[],
  i: number
): boolean {
  const need = reported[i]! * CORROBORATE_FRACTION;
  for (const j of [i - 1, i + 1]) {
    const other = stretch[j];
    // A neighbour that is itself a bad fix or in the air vouches for nothing.
    if (!other || !ok[j]) continue;
    const dt = Math.abs(other[0] - stretch[i][0]);
    if (dt > CORROBORATE_WITHIN_MS) continue;
    const step = dt > 0 ? distanceM(fixOf(stretch[i]), fixOf(other)) / (dt / 1000) : 0;
    if (step > MAX_SPEED_MPS) continue;
    if (Math.max(reported[j] ?? 0, step) >= need) return true;
  }
  return false;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The highest median-smoothed altitude of a stretch, or null with fewer than three believable fixes. */
function highestOf(
  stretch: readonly StoredPoint[],
  rowOf: RowOf,
  inFlight: InFlight
): { m: number; atMs: number } | null {
  const alts: { m: number; atMs: number }[] = [];
  for (const p of stretch) {
    const row = rowOf(p);
    if (!usable(p, row, inFlight)) continue;
    const m = plausibleAltitudeM(row);
    if (m !== null) alts.push({ m, atMs: p[0] });
  }
  let best: { m: number; atMs: number } | null = null;
  const half = Math.floor(MEDIAN_WINDOW / 2);
  for (let i = 0; i < alts.length; i++) {
    const window = alts.slice(Math.max(0, i - half), i + half + 1);
    if (window.length < MEDIAN_MIN) continue;
    const m = median(window.map((a) => a.m));
    if (best === null || m > best.m) best = { m, atMs: alts[i].atMs };
  }
  return best;
}

/** `figures` and these stretches together, as a new value. */
export function addStretches(
  figures: EverydayFigures,
  stretches: readonly StoredPoint[][],
  rowOf: RowOf,
  inFlight: InFlight
): EverydayFigures {
  let topSpeed = figures.topSpeed;
  let highest = figures.highest;
  for (const stretch of stretches) {
    const speed = topSpeedOf(stretch, rowOf, inFlight);
    if (speed && (topSpeed === null || speed.mps > topSpeed.mps)) topSpeed = speed;
    const height = highestOf(stretch, rowOf, inFlight);
    if (height && (highest === null || height.m > highest.m)) highest = height;
  }
  const byMotion = Object.fromEntries(
    Object.entries(figures.byMotion).map(([k, v]) => [k, { ...v }])
  ) as EverydayFigures["byMotion"];
  for (const step of groundSteps(stretches, inFlight)) {
    const ms = step.to[0] - step.from[0];
    if (ms > STEP_MAX_MS) continue;
    const bucket = byMotion[motionClassOf(rowOf(step.to)?.motion ?? null)];
    bucket.ms += ms;
    bucket.km += step.km;
  }
  return { topSpeed, highest, byMotion };
}
