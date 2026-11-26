/**
 * One place, one stop — the day view's half of the rule the stay detector follows
 * (`dawarich/stays/detect.ts`, `mergeFragments`), so the day view and the inbox agree. Prod
 * 25.11.2026: 10:01-10:43 and 11:20-15:42 at one building, joined by 88 good fixes that never
 * left it (74 m at most), drawn as two stops and a "leg" between them.
 *
 * Joined when the gap is at most `MERGE_GAP_MS`, the two anchors lie within the stay radius, and
 * every fix of usable accuracy in the gap stays within `GAP_WANDER_M` of the first stop. Tighter
 * than the detector's 300 m on purpose: a walk of 150 m away and back is a real trip here, with
 * its own leg (`travtrack.stopPlaces.test.ts`). Coarse fixes (> 100 m accuracy) say nothing.
 * Two stops the owner named differently, a fold into a fixed place, or a dismissal stay apart.
 */
import { distanceM } from "../classify";
import type { StoredPoint } from "../../tripRecording/segments";
import type { Leg, Stop } from "./types";

export const MERGE_GAP_MS = 45 * 60_000;
export const MERGE_ANCHOR_M = 150;
export const GAP_WANDER_M = 100;
const USABLE_ACCURACY_M = 100;

function joinable(a: Stop, b: Stop, points: readonly StoredPoint[]): boolean {
  const gap = b.fromMs - a.untilMs;
  if (gap < 0 || gap > MERGE_GAP_MS) return false;
  if (a.folded || b.folded || Boolean(a.dismissed) !== Boolean(b.dismissed)) return false;
  if (a.place && b.place && a.place.name !== b.place.name) return false;
  if (distanceM(a.anchor, b.anchor) > MERGE_ANCHOR_M) return false;
  return points.every(
    (p) =>
      p[0] <= a.untilMs ||
      p[0] >= b.fromMs ||
      (p[3] !== null && p[3] > USABLE_ACCURACY_M) ||
      distanceM(a.anchor, { lat: p[1], lon: p[2] }) <= GAP_WANDER_M
  );
}

function coverageOfJoined(a: Stop, b: Stop): Stop["coverage"] {
  if (!a.coverage && !b.coverage) return undefined;
  const part = (s: Stop) =>
    s.coverage ?? { observedMs: s.untilMs - s.fromMs, inferredMs: 0, gaps: [] };
  const [x, y] = [part(a), part(b)];
  return {
    // The gap between them was measured: its fixes are what joined the two.
    observedMs: x.observedMs + y.observedMs + (b.fromMs - a.untilMs),
    inferredMs: x.inferredMs + y.inferredMs,
    gaps: [...x.gaps, ...y.gaps],
  };
}

/** `stops` and `legs` sorted by time; returns both with neighbouring fragments joined. */
export function mergeNearStops(
  stops: readonly Stop[],
  legs: readonly Leg[],
  points: readonly StoredPoint[]
): { stops: Stop[]; legs: Leg[] } {
  const out: Stop[] = [];
  const gaps: Array<[number, number]> = [];
  for (const b of stops) {
    const a = out.at(-1);
    if (!a || !joinable(a, b, points)) {
      out.push(b);
      continue;
    }
    gaps.push([a.untilMs, b.fromMs]);
    const coverage = coverageOfJoined(a, b);
    const { openEnd: _end, coverage: _cov, ...head } = a;
    out[out.length - 1] = {
      ...head,
      untilMs: b.untilMs,
      place: a.place ?? b.place,
      stayRef: a.stayRef ?? b.stayRef,
      ...(a.evidence || b.evidence ? { evidence: a.evidence ?? b.evidence } : {}),
      ...(b.openEnd ? { openEnd: true as const } : {}),
      ...(coverage ? { coverage } : {}),
    };
  }
  const inGap = (l: Leg) => gaps.some(([from, until]) => l.fromMs >= from && l.untilMs <= until);
  return { stops: out, legs: legs.filter((l) => !inGap(l)) };
}
