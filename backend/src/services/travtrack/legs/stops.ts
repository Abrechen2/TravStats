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

/**
 * A fix this coarse is a cell or Wi-Fi fallback, not a position: one of 1.9 km
 * and one of 2.7 km each put a day's line 1.3-1.5 km off while the phone lay
 * still. `isBadFix` (10 km) is the evidence pipeline's bound; a line drawn for
 * a person needs a tighter one.
 */
export const MAX_DRAWN_ACCURACY_M = 1000;

export const isBadVertex = (p: StoredPoint): boolean =>
  isBadFix({ atMs: p[0], lat: p[1], lon: p[2], accuracyM: p[3] }) ||
  (p[3] !== null && p[3] > MAX_DRAWN_ACCURACY_M);

/**
 * The ONE verdict on which fixes of a stretch are left out, shared by drawing
 * (`drawnFixes.ts`) and dwell detection: null island is always bad; a coarse
 * fix (> `MAX_DRAWN_ACCURACY_M`) is bad only where the stretch holds a finer
 * one. A stretch of ONLY coarse fixes keeps them, so such a day is drawn and
 * its stops are found alike. Stops carry no accuracy or radius, so nothing
 * here can make a coarse stop look more precise than it is.
 */
export function badVertexIn(stretch: readonly StoredPoint[]): (p: StoredPoint) => boolean {
  const isCoarse = (p: StoredPoint) => p[3] !== null && p[3] > MAX_DRAWN_ACCURACY_M;
  const hasFiner = stretch.some((p) => !isBadVertex(p));
  return (p) =>
    isBadFix({ atMs: p[0], lat: p[1], lon: p[2], accuracyM: p[3] }) || (isCoarse(p) && hasFiner);
}

/**
 * A wander inside one place: two dwells whose anchors lie closer than this,
 * with nothing in between straying further, are one stop. A phone on a hotel
 * night table wandered 57 m at ~5 m accuracy and came back; that is not a
 * leg. Equal to `MIN_LEG_M` — a stretch that short is no leg anyway.
 */
export const WANDER_M = 100;

const at = (p: StoredPoint) => ({ lat: p[1], lon: p[2] });

/** A dwell as vertex indices into one segment, inclusive. */
export type Dwell = { from: number; to: number };

export function findDwells(segment: readonly StoredPoint[]): Dwell[] {
  const out: Dwell[] = [];
  const n = segment.length;
  const bad = badVertexIn(segment);
  let i = 0;
  while (i < n) {
    if (bad(segment[i])) {
      i += 1;
      continue;
    }
    let j = i;
    while (
      j + 1 < n &&
      (bad(segment[j + 1]) ||
        distanceM(
          { lat: segment[i][1], lon: segment[i][2] },
          { lat: segment[j + 1][1], lon: segment[j + 1][2] }
        ) < STEP_M)
    )
      j += 1;
    while (j > i && bad(segment[j])) j -= 1;
    if (segment[j][0] - segment[i][0] >= STOP_MS) out.push({ from: i, to: j });
    i = j + 1;
  }
  return mergeWanders(segment, out, bad);
}

/** Dwells of one place broken only by a short wander, joined into one. */
function mergeWanders(
  segment: readonly StoredPoint[],
  dwells: readonly Dwell[],
  isBad: (p: StoredPoint) => boolean
): Dwell[] {
  const out: Dwell[] = [];
  for (const d of dwells) {
    const prev = out[out.length - 1];
    if (prev && sameSpot(segment, prev, d, isBad))
      out[out.length - 1] = { from: prev.from, to: d.to };
    else out.push({ ...d });
  }
  return out;
}

function sameSpot(
  segment: readonly StoredPoint[],
  a: Dwell,
  b: Dwell,
  isBad: (p: StoredPoint) => boolean
): boolean {
  const anchor = at(segment[a.from]);
  if (distanceM(anchor, at(segment[b.from])) >= WANDER_M) return false;
  for (let k = a.to; k <= b.from; k++) {
    if (isBad(segment[k])) continue;
    if (distanceM(anchor, at(segment[k])) >= WANDER_M) return false;
  }
  return true;
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
