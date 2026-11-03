import { isBadFix } from "../../locationEvidence/anomaly";
import type { StoredPoint } from "../../tripRecording/segments";
import { distanceM } from "../classify";
import { STEP_M, STOP_MS } from "../dayMovement";

/**
 * Where a day's stretches stand still. The rule is `dayMovement.ts`'s own
 * (`STEP_M`, `STOP_MS`): a dwell is a run of fixes that stay within `STEP_M`
 * of the run's first fix for at least `STOP_MS`. A fix with a bad accuracy
 * neither breaks nor ends a dwell.
 */

export const isBadVertex = (p: StoredPoint): boolean =>
  isBadFix({ atMs: p[0], lat: p[1], lon: p[2], accuracyM: p[3] });

/** A dwell as vertex indices into one segment, inclusive. */
export type Dwell = { from: number; to: number };

export function findDwells(segment: readonly StoredPoint[]): Dwell[] {
  const out: Dwell[] = [];
  const n = segment.length;
  let i = 0;
  while (i < n) {
    if (isBadVertex(segment[i])) {
      i += 1;
      continue;
    }
    let j = i;
    while (
      j + 1 < n &&
      (isBadVertex(segment[j + 1]) ||
        distanceM(
          { lat: segment[i][1], lon: segment[i][2] },
          { lat: segment[j + 1][1], lon: segment[j + 1][2] }
        ) < STEP_M)
    )
      j += 1;
    while (j > i && isBadVertex(segment[j])) j -= 1;
    if (segment[j][0] - segment[i][0] >= STOP_MS) out.push({ from: i, to: j });
    i = j + 1;
  }
  return out;
}

/**
 * The runs between dwells (and the segment's ends) a leg may lie in, as
 * inclusive vertex ranges with at least two vertices. A run starts at the
 * last fix of the dwell before it and ends at the first fix of the next, so
 * a leg touches its stops.
 */
export function movingRuns(segmentLength: number, dwells: readonly Dwell[]): Dwell[] {
  const runs: Dwell[] = [];
  let start = 0;
  for (const d of dwells) {
    if (d.from > start) runs.push({ from: start, to: d.from });
    start = d.to;
  }
  if (segmentLength - 1 > start) runs.push({ from: start, to: segmentLength - 1 });
  return runs;
}
