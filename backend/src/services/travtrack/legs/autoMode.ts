import type { StoredPoint } from "../../tripRecording/segments";
import { distanceM } from "../classify";
import { MAX_SPEED_MPS, motionClassOf, plausibleSpeedMps } from "../everyday/plausible";
import { STEP_MAX_MS } from "../everyday/fold";
import type { SafePointRow } from "../readSafe";
import { isBadVertex } from "./stops";
import type { LegMode } from "./types";

/**
 * The automatic mode of a stretch (spec §1.3): only from CORROBORATED
 * motion. A step is classed from what the phone reported (`motion`) AND the
 * speed the fixes themselves show; where the two do not agree, or the phone
 * said nothing, or the step spans a recording gap, it is `unknown` — never a
 * guess. A stretch gets a mode when one class carries it clearly.
 *
 * Bands are m/s, deliberately narrow: walking 0.3–3, running 1.5–7.5, cycling
 * 2–12, driving from 5 (18 km/h). A phone does not tell a bus from a car or a
 * train from a tram: `car` is what motorised motion says; entries carry the
 * rest.
 */

export type StepClass = LegMode | "still";

const BANDS: Record<string, { mode: LegMode; min: number; max: number }> = {
  walking: { mode: "walk", min: 0.3, max: 3 },
  running: { mode: "run", min: 1.5, max: 7.5 },
  cycling: { mode: "cycle", min: 2, max: 12 },
  automotive: { mode: "car", min: 5, max: MAX_SPEED_MPS },
};

/** Below this a step is standing still: no class of its own. */
export const STILL_MPS = 0.3;
/** The share of a stretch one class must hold for the mode to be that class. */
export const CLEAR_SHARE = 0.8;
/** Below `CLEAR_SHARE` but at least this: the mode is named, with low confidence. */
export const LEAN_SHARE = 0.6;
/** A run of one class shorter than this is absorbed by its neighbour. */
export const MIN_RUN_MS = 2 * 60_000;

type RowOf = (point: StoredPoint) => SafePointRow | undefined;

export function stepClass(a: StoredPoint, b: StoredPoint, rowOf: RowOf): StepClass {
  const dt = b[0] - a[0];
  if (dt <= 0 || dt > STEP_MAX_MS || isBadVertex(a) || isBadVertex(b)) return "unknown";
  const v = distanceM({ lat: a[1], lon: a[2] }, { lat: b[1], lon: b[2] }) / (dt / 1000);
  if (v > MAX_SPEED_MPS) return "unknown";
  if (v < STILL_MPS) return "still";
  const row = rowOf(b);
  if (!row || row.purpose === "flight") return "unknown";
  const reported = plausibleSpeedMps(row);
  // The phone's own speed must not contradict the fixes' (GPS spike, wrong class).
  if (reported !== null && Math.abs(reported - v) > Math.max(2, 0.5 * v)) return "unknown";
  const band = BANDS[motionClassOf(row.motion)];
  return band && v >= band.min && v <= band.max ? band.mode : "unknown";
}

/** `still` steps take the class of the step before them (the one after, at the start). */
export function settleStill(classes: readonly StepClass[]): LegMode[] {
  const firstReal = classes.find((c) => c !== "still") ?? "unknown";
  let last: LegMode = firstReal as LegMode;
  return classes.map((c) => {
    if (c !== "still") last = c;
    return last;
  });
}

/** One class over consecutive steps `from..to` (step k joins vertex k and k + 1). */
export type ClassRun = { from: number; to: number; mode: LegMode };

/**
 * Runs of equal class, with every run shorter than `MIN_RUN_MS` taken into the
 * longer of its neighbours until none is left, so a minute of GPS wobble does
 * not cut a walk in two.
 */
export function classRuns(
  run: readonly StoredPoint[],
  firstVertex: number,
  classes: readonly LegMode[]
): ClassRun[] {
  const at = (k: number) => run[k - firstVertex][0];
  let runs: ClassRun[] = [];
  classes.forEach((mode, i) => {
    const k = firstVertex + i;
    const last = runs[runs.length - 1];
    if (last && last.mode === mode) last.to = k;
    else runs.push({ from: k, to: k, mode });
  });
  const span = (r: ClassRun) => at(r.to + 1) - at(r.from);
  for (;;) {
    if (runs.length < 2) return runs;
    const short = runs
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => span(r) < MIN_RUN_MS)
      .sort((x, y) => span(x.r) - span(y.r))[0];
    if (!short) return runs;
    const prev = runs[short.i - 1];
    const next = runs[short.i + 1];
    const into = prev && (!next || span(prev) >= span(next)) ? prev : next;
    const merged: ClassRun = {
      from: Math.min(into.from, short.r.from),
      to: Math.max(into.to, short.r.to),
      mode: into.mode,
    };
    runs = runs
      .flatMap((r) => (r === into ? [merged] : r === short.r ? [] : [r]))
      // The neighbours of an absorbed run may now be one run of the same class.
      .reduce<ClassRun[]>((acc, r) => {
        const last = acc[acc.length - 1];
        if (last && last.mode === r.mode) return [...acc.slice(0, -1), { ...last, to: r.to }];
        return [...acc, r];
      }, []);
  }
}

/** The mode of steps `from..to` and how sure: by the share of their time one class holds. */
export function modeOfSteps(
  run: readonly StoredPoint[],
  firstVertex: number,
  classes: readonly LegMode[],
  from: number,
  to: number
): { mode: LegMode; confidence: "high" | "low" } {
  const byClass = new Map<LegMode, number>();
  let total = 0;
  for (let k = from; k <= to; k++) {
    const ms = run[k + 1 - firstVertex][0] - run[k - firstVertex][0];
    byClass.set(classes[k - firstVertex], (byClass.get(classes[k - firstVertex]) ?? 0) + ms);
    total += ms;
  }
  let best: LegMode = "unknown";
  let bestMs = 0;
  for (const [mode, ms] of byClass)
    if (mode !== "unknown" && ms > bestMs) [best, bestMs] = [mode, ms];
  const share = total > 0 ? bestMs / total : 0;
  if (share >= CLEAR_SHARE) return { mode: best, confidence: "high" };
  if (share >= LEAN_SHARE) return { mode: best, confidence: "low" };
  return { mode: "unknown", confidence: "low" };
}
