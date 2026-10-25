import type { StoredPoint } from "../tripRecording/segments";
import { distanceM } from "./classify";
import type { Span } from "./readSafe";

/**
 * The moving stretches of a day that nothing in the logbook covers
 * (TravTrack plan E10): "Unterwegs, ohne Eintrag". Pure, and read from the
 * day's privacy-safe segments only, so no stretch starts, ends or is anchored
 * inside a zone. It says THAT the user moved, never how — no mode is guessed.
 *
 * A stretch is movement, not a phone's wandering fix: distance accrues only
 * once a fix lies `STEP_M` from the last one that counted (a distance filter,
 * so 30 m of jitter at a table adds nothing), and a quarter of an hour without
 * such a step ends the stretch — a morning's drive and an afternoon's walk
 * are two stretches, not one from 08:00 to 18:00.
 */

/** A stretch shorter than this along its way is no journey worth a label. */
export const UNLABELLED_MIN_KM = 2;
/** A fix this far from the last counted one is a step; anything nearer is jitter. */
export const STEP_M = 50;
/** This long without a step ends a stretch. */
export const STOP_MS = 15 * 60_000;

export type UnlabelledStretch = Span & { anchor: { lat: number; lon: number } };

const covered = (tMs: number, spans: readonly Span[]) =>
  spans.some((s) => tMs >= s.fromMs && tMs <= s.untilMs);

/** The runs of consecutive fixes no span covers. */
function uncoveredRuns(segment: readonly StoredPoint[], spans: readonly Span[]): StoredPoint[][] {
  const runs: StoredPoint[][] = [];
  let run: StoredPoint[] = [];
  for (const p of segment) {
    if (covered(p[0], spans)) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

const position = (p: StoredPoint) => ({ lat: p[1], lon: p[2] });

/** The moving pieces of one run, each from the fix before its first step to its last step. */
function movingPieces(run: readonly StoredPoint[]): UnlabelledStretch[] {
  const out: UnlabelledStretch[] = [];
  let piece: { start: StoredPoint; end: StoredPoint; metres: number } | null = null;
  const close = () => {
    if (piece && piece.metres >= UNLABELLED_MIN_KM * 1000) {
      out.push({
        fromMs: piece.start[0],
        untilMs: piece.end[0],
        anchor: position(piece.start),
      });
    }
    piece = null;
  };
  let kept = run[0];
  let previous = run[0];
  for (const p of run.slice(1)) {
    const step = distanceM(position(kept), position(p));
    if (step >= STEP_M) {
      if (piece === null || p[0] - piece.end[0] > STOP_MS) {
        close();
        piece = { start: previous, end: p, metres: 0 };
      }
      piece.metres += step;
      piece.end = p;
      kept = p;
    }
    previous = p;
  }
  close();
  return out;
}

/** Every uncovered moving stretch of the day, in time order. */
export function unlabelledStretches(
  segments: readonly StoredPoint[][],
  coveredSpans: readonly Span[]
): UnlabelledStretch[] {
  return segments
    .flatMap((segment) => uncoveredRuns(segment, coveredSpans))
    .flatMap(movingPieces)
    .sort((a, b) => a.fromMs - b.fromMs);
}
