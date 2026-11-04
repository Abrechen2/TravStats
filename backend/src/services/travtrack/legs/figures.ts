import type { StoredPoint } from "../../tripRecording/segments";
import { distanceM } from "../classify";
import { MAX_SPEED_MPS } from "../everyday/plausible";
import { smoothedAltitudes, STEP_MAX_MS, topSpeedOf } from "../everyday/fold";
import type { InFlight } from "../months/values";
import type { SafePointRow } from "../readSafe";
import { STILL_MPS } from "./autoMode";
import { topWindowSpeedMps } from "./windowSpeed";
import { isBadVertex } from "./stops";
import type { Leg } from "./types";

/**
 * The figures of one leg (spec §1: "figures reuse the everyday rules"). Top
 * speed is `everyday/fold.ts`'s spike rule, the heights its median smoothing.
 * A figure that cannot be derived is null, never 0: a step across a recording
 * gap is no time spent moving, and a leg with no believable altitude has no
 * ascent.
 */

/** A rise or fall smaller than this is altitude noise, not climbing. */
export const ALTITUDE_DEADBAND_M = 3;

type RowOf = (point: StoredPoint) => SafePointRow | undefined;

export type LegFigures = Pick<
  Leg,
  "distanceM" | "movingMs" | "avgSpeedMps" | "maxSpeedMps" | "ascentM" | "descentM" | "bounds"
>;

function climb(heights: readonly number[]): { up: number; down: number } | null {
  if (heights.length < 2) return null;
  let up = 0;
  let down = 0;
  let ref = heights[0];
  for (const m of heights.slice(1)) {
    if (Math.abs(m - ref) < ALTITUDE_DEADBAND_M) continue;
    if (m > ref) up += m - ref;
    else down += ref - m;
    ref = m;
  }
  return { up, down };
}

export function legFigures(
  points: readonly StoredPoint[],
  rowOf: RowOf,
  inFlight: InFlight,
  /** False for a flight, whose pace is above any ground cap. */
  groundOnly = true
): LegFigures {
  let distance = 0;
  let movingMs = 0;
  let movingM = 0;
  let measured = false;
  for (let k = 1; k < points.length; k++) {
    const [a, b] = [points[k - 1], points[k]];
    if (isBadVertex(a) || isBadVertex(b)) continue;
    const step = distanceM({ lat: a[1], lon: a[2] }, { lat: b[1], lon: b[2] });
    const dt = b[0] - a[0];
    // A jump no ground vehicle makes is a GPS glitch, not distance (everyday rule).
    if (groundOnly && dt > 0 && step / (dt / 1000) > MAX_SPEED_MPS) continue;
    distance += step;
    if (dt <= 0 || dt > STEP_MAX_MS) continue;
    measured = true;
    if (step / (dt / 1000) >= STILL_MPS) {
      movingMs += dt;
      movingM += step;
    }
  }
  const good = points.filter((p) => !isBadVertex(p));
  const box = (good.length > 0 ? good : points).reduce<[number, number, number, number]>(
    (b, p) => [
      Math.min(b[0], p[2]),
      Math.min(b[1], p[1]),
      Math.max(b[2], p[2]),
      Math.max(b[3], p[1]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
  const heights = smoothedAltitudes(points, rowOf, inFlight).map((a) => a.m);
  const moved = climb(heights);
  return {
    distanceM: Math.round(distance),
    movingMs: measured ? movingMs : null,
    avgSpeedMps: measured && movingMs > 0 ? movingM / (movingMs / 1000) : null,
    // No reported speed (GPX, Companion without speed): the glitch-safe window speeds.
    maxSpeedMps:
      topSpeedOf(points, rowOf, inFlight)?.mps ?? (groundOnly ? topWindowSpeedMps(points) : null),
    ascentM: moved ? Math.round(moved.up) : null,
    descentM: moved ? Math.round(moved.down) : null,
    bounds: box,
  };
}
