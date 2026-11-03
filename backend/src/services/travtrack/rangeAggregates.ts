import type { FlightWindow } from "../locationEvidence/anomaly";
import type { StoredPoint } from "../tripRecording/segments";
import { STEP_MAX_MS, topSpeedOf } from "./everyday/fold";
import { groundSteps, inFlightBy } from "./months/values";
import { STILL_MPS } from "./legs/autoMode";
import type { SafePointRow } from "./readSafe";

/**
 * The figures a range answer carries beside its drawing (spec
 * 2026-11-03-travtrack-legs, §2). Computed from the privacy-safe points as
 * stored, never from the simplified geometry: simplifying drops vertices, so
 * a distance read from it would shrink with the zoom budget. Of one part of
 * the answer, like the geometry.
 *
 *   - `distanceM` — ground distance (the rules of the monthly kilometres: no
 *     step in the air, none faster than 500 km/h, none from a bad fix).
 *   - `movingMs` — time of the steps that moved and span no recording gap;
 *     null when no step could be measured, never 0.
 *   - `maxSpeedMps` — the everyday top speed (spike rule); null when none.
 */

export type RangeAggregates = {
  distanceM: number;
  movingMs: number | null;
  maxSpeedMps: number | null;
};

export function rangeAggregates(
  stretches: readonly StoredPoint[][],
  rowOf: (point: StoredPoint) => SafePointRow | undefined,
  flights: readonly FlightWindow[] = []
): RangeAggregates {
  const inFlight = inFlightBy(flights, (p) => rowOf(p)?.purpose === "flight");
  let distance = 0;
  let movingMs = 0;
  let measured = false;
  for (const step of groundSteps(stretches as StoredPoint[][], inFlight)) {
    distance += step.km * 1000;
    const dt = step.to[0] - step.from[0];
    if (dt > STEP_MAX_MS) continue;
    measured = true;
    if ((step.km * 1000) / (dt / 1000) >= STILL_MPS) movingMs += dt;
  }
  let max: number | null = null;
  for (const stretch of stretches) {
    const top = topSpeedOf(stretch, rowOf, inFlight);
    if (top && (max === null || top.mps > max)) max = top.mps;
  }
  return {
    distanceM: Math.round(distance),
    movingMs: measured ? movingMs : null,
    maxSpeedMps: max,
  };
}
