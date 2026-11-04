import type { StoredPoint } from "../../tripRecording/segments";
import { distanceM } from "../classify";
import { MAX_SPEED_MPS, motionClassOf, plausibleSpeedMps } from "../everyday/plausible";
import { STEP_MAX_MS } from "../everyday/fold";
import type { SafePointRow } from "../readSafe";
import { STILL_MPS } from "./autoMode";
import { isBadVertex } from "./stops";
import type { LegMode } from "./types";

/**
 * The automatic mode of a stretch from its SPEED PROFILE alone (owner
 * decision 2026-11-04). The Companion never sends `motion`, so without this
 * every auto leg was `unknown`. It is a fallback: it applies only where no
 * point of the stretch carries a usable motion class (see `hasUsableMotion`),
 * and its answer is always `low` confidence.
 *
 * Only walk, cycle and car. A speed cannot tell a train from a car or a bus
 * from either, nor a boat; those come from entries or corrections. `run` is
 * left out on purpose: a jog (2.5–4.5 m/s) sits inside slow cycling, and a
 * wrong "run" is worse than "unknown".
 *
 * The profile is the time-weighted percentiles of the MOVING steps (at least
 * `STILL_MPS`), after the glitch caps (bad fix, gap over `STEP_MAX_MS`, jump
 * above `MAX_SPEED_MPS`). Percentiles, not the mean: stops and a single spike
 * must not move the verdict. Anything between the bands, or too thin to
 * judge, is `unknown` — abstention is a result.
 */

/** Fewer moving steps than this say nothing about a pace. */
export const SPEED_MIN_STEPS = 5;
/** Less moving time than this (ms) is a shuffle, not a profile. */
export const SPEED_MIN_MOVING_MS = 3 * 60_000;
/** Less ground than this (m) cannot separate a walk from GPS drift. */
export const SPEED_MIN_DISTANCE_M = 300;

/** Walk: 2–8 km/h typical; brisk 6.5 km/h = 1.8 m/s. Nothing above a stride. */
export const WALK_P50_MPS = { min: 0.6, max: 2.2 } as const;
export const WALK_P95_MAX_MPS = 3.3;
export const WALK_MAX_MPS = 6;

/** Cycle: 12–30 km/h typical. p95 under 10.5 m/s (38 km/h) keeps it apart from traffic. */
export const CYCLE_P50_MPS = { min: 3.5, max: 7 } as const;
export const CYCLE_P95_MAX_MPS = 10.5;
export const CYCLE_MAX_MPS = 13;

/**
 * Car: a bike does not hold 43 km/h for two minutes, a car in a town does. The
 * median is only a floor (creeping traffic is a car day too); the evidence is
 * the time spent at or above `CAR_FAST_MPS`, which one GPS spike cannot supply.
 */
export const CAR_P50_MIN_MPS = 3;
export const CAR_FAST_MPS = 12;
export const CAR_FAST_MIN_MS = 2 * 60_000;

type RowOf = (point: StoredPoint) => SafePointRow | undefined;

/** True when any point of the stretch carries a motion class a band can use. */
export function hasUsableMotion(points: readonly StoredPoint[], rowOf: RowOf): boolean {
  return points.some((p) => {
    const m = motionClassOf(rowOf(p)?.motion ?? null);
    return m === "walking" || m === "running" || m === "cycling" || m === "automotive";
  });
}

type MovingStep = { mps: number; ms: number };

/** The moving steps with a believable speed: the fix's own where it agrees with the deltas, else the deltas'. */
function movingSteps(points: readonly StoredPoint[], rowOf: RowOf): MovingStep[] | null {
  const out: MovingStep[] = [];
  for (let k = 1; k < points.length; k++) {
    const [a, b] = [points[k - 1], points[k]];
    const row = rowOf(b);
    if (row?.purpose === "flight" || rowOf(a)?.purpose === "flight") return null;
    const dt = b[0] - a[0];
    if (dt <= 0 || dt > STEP_MAX_MS || isBadVertex(a) || isBadVertex(b)) continue;
    const v = distanceM({ lat: a[1], lon: a[2] }, { lat: b[1], lon: b[2] }) / (dt / 1000);
    if (v > MAX_SPEED_MPS || v < STILL_MPS) continue;
    const reported = row ? plausibleSpeedMps(row) : null;
    const agrees = reported !== null && Math.abs(reported - v) <= Math.max(2, 0.5 * v);
    out.push({ mps: agrees ? reported : v, ms: dt });
  }
  return out;
}

/** Time-weighted quantile of already sorted steps. */
function quantile(sorted: readonly MovingStep[], total: number, q: number): number {
  let acc = 0;
  for (const s of sorted) {
    acc += s.ms;
    if (acc >= q * total) return s.mps;
  }
  return sorted[sorted.length - 1].mps;
}

const within = (v: number, r: { min: number; max: number }) => v >= r.min && v <= r.max;

/** The mode the stretch's speed profile names, or null where it is ambiguous or too thin. */
export function modeFromSpeed(
  points: readonly StoredPoint[],
  rowOf: RowOf
): { mode: LegMode; confidence: "low" } | null {
  const steps = movingSteps(points, rowOf);
  if (!steps || steps.length < SPEED_MIN_STEPS) return null;
  const movingMs = steps.reduce((s, x) => s + x.ms, 0);
  const metres = steps.reduce((s, x) => s + x.mps * (x.ms / 1000), 0);
  if (movingMs < SPEED_MIN_MOVING_MS || metres < SPEED_MIN_DISTANCE_M) return null;
  const sorted = [...steps].sort((x, y) => x.mps - y.mps);
  const p50 = quantile(sorted, movingMs, 0.5);
  const p95 = quantile(sorted, movingMs, 0.95);
  const max = sorted[sorted.length - 1].mps;
  const fastMs = steps.filter((x) => x.mps >= CAR_FAST_MPS).reduce((t, x) => t + x.ms, 0);
  if (within(p50, WALK_P50_MPS) && p95 <= WALK_P95_MAX_MPS && max <= WALK_MAX_MPS)
    return { mode: "walk", confidence: "low" };
  if (within(p50, CYCLE_P50_MPS) && p95 <= CYCLE_P95_MAX_MPS && max <= CYCLE_MAX_MPS)
    return { mode: "cycle", confidence: "low" };
  if (p50 >= CAR_P50_MIN_MPS && fastMs >= CAR_FAST_MIN_MS)
    return { mode: "car", confidence: "low" };
  return null;
}
