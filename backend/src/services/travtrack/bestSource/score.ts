import { haversineKm } from "../../../shared/geo/haversine";
import { isBadFix } from "../../locationEvidence/anomaly";
import type { SourcePoint, SourceScore, SourceSignals, Window } from "./types";

/**
 * The quality score of one source on one day, 0..1, from robust, capped
 * signals. Each signal is bounded on its own, so no single extreme (a burst of
 * ten thousand fixes, one wild jump) decides the day. A missing accuracy is
 * UNKNOWN — neither good nor bad: a Google Timeline export almost never carries
 * one, and scoring the absence as bad would hand every such day to whatever
 * else exists, scoring it as good would hide the 2000 m fixes it does carry.
 */

/** A silence of a source longer than this is a gap in it. */
export const LONG_GAP_MS = 30 * 60_000;
/** A step faster than this is a jump unless a logged journey explains it… */
export const JUMP_KMH = 300;
/** …and covers at least this far: jitter of a coarse fix is not a teleport. */
export const JUMP_MIN_KM = 25;
/** Usable points per hour at which density counts as full. */
export const DENSITY_FULL_PER_HOUR = 60;

const WEIGHTS = { density: 0.3, accuracy: 0.15, gaps: 0.2, jumps: 0.15, coverage: 0.2 } as const;
/** Ten jumps in a hundred steps already zero the jump signal. */
const JUMP_RATE_ZERO = 0.1;
/** The contribution of a point without an accuracy: unknown, the middle. */
const UNKNOWN_ACCURACY = 0.5;
const HOUR_MS = 3_600_000;

export const usable = (p: SourcePoint): boolean => !isBadFix({ ...p, atMs: p.tMs });

/** How good one stated accuracy is, 0..1. */
export function accuracyQuality(m: number): number {
  if (m <= 50) return 1;
  if (m <= 200) return 0.7;
  if (m <= 1000) return 0.3;
  return 0;
}

export function stepKmh(a: SourcePoint, b: SourcePoint): number {
  return haversineKm(a, b) / (Math.max(1000, b.tMs - a.tMs) / HOUR_MS);
}

/** A step no ground or sea journey makes: fast and far. */
export const isJumpStep = (a: SourcePoint, b: SourcePoint): boolean =>
  haversineKm(a, b) >= JUMP_MIN_KM && stepKmh(a, b) > JUMP_KMH;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The signals of one source's points (time-ordered) on the day `window`. */
export function sourceSignals(points: readonly SourcePoint[], window: Window): SourceSignals {
  const good = points.filter(usable);
  const known = points.filter((p) => p.accuracyM !== null);
  if (good.length === 0) {
    return {
      points: points.length,
      usable: 0,
      perHour: 0,
      accuracyKnownShare: points.length ? known.length / points.length : 0,
      longGapShare: 1,
      jumpRate: 0,
      coverage: 0,
    };
  }
  const first = good[0].tMs;
  const last = good[good.length - 1].tMs;
  const spanMs = Math.max(HOUR_MS, last - first);
  let gapMs = 0;
  let jumps = 0;
  for (let i = 1; i < good.length; i++) {
    const step = good[i].tMs - good[i - 1].tMs;
    if (step > LONG_GAP_MS) gapMs += step;
    if (isJumpStep(good[i - 1], good[i])) jumps++;
  }
  return {
    points: points.length,
    usable: good.length,
    perHour: good.length / (spanMs / HOUR_MS),
    accuracyKnownShare: known.length / points.length,
    longGapShare: clamp01(gapMs / spanMs),
    jumpRate: good.length > 1 ? jumps / (good.length - 1) : 0,
    coverage: clamp01((last - first) / Math.max(1, window.untilMs - window.fromMs)),
  };
}

/** The score of these signals and the points' accuracies. */
export function scoreOf(signals: SourceSignals, points: readonly SourcePoint[]): number {
  if (signals.usable === 0) return 0;
  const density = clamp01(Math.log1p(signals.perHour) / Math.log1p(DENSITY_FULL_PER_HOUR));
  const accuracy =
    points.reduce(
      (sum, p) => sum + (p.accuracyM === null ? UNKNOWN_ACCURACY : accuracyQuality(p.accuracyM)),
      0
    ) / points.length;
  const gaps = 1 - signals.longGapShare;
  const jumps = 1 - clamp01(signals.jumpRate / JUMP_RATE_ZERO);
  const score =
    WEIGHTS.density * density +
    WEIGHTS.accuracy * accuracy +
    WEIGHTS.gaps * gaps +
    WEIGHTS.jumps * jumps +
    WEIGHTS.coverage * signals.coverage;
  return Math.round(score * 1000) / 1000;
}

/** Every source of the day, best first; a tie goes to the origin name, so the order is stable. */
export function rankSources(
  byOrigin: ReadonlyMap<string, readonly SourcePoint[]>,
  window: Window
): SourceScore[] {
  return [...byOrigin.entries()]
    .map(([source, points]) => {
      const signals = sourceSignals(points, window);
      return { source, score: scoreOf(signals, points), signals };
    })
    .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source));
}
