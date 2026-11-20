import type { StoredPoint } from "../../tripRecording/segments";
import { STOP_MS } from "../dayMovement";
import type { Stop, StopCoverage } from "./types";

/**
 * What of a stop the phone actually reported, and what is only assumed. A phone at rest sends
 * nothing, so a stay may be joined across a silence (a bridged stop, a fold over a quiet night);
 * coming back to the same place never proves the phone stayed there. Every stretch inside the
 * stop with no fix for at least `STOP_MS` is therefore listed as a gap: time the stop covers
 * by inference, never by measurement.
 */
export function coverageOf(
  points: readonly StoredPoint[],
  span: { fromMs: number; untilMs: number }
): StopCoverage | undefined {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const gaps: Array<{ fromMs: number; untilMs: number }> = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] - sorted[i - 1][0] < STOP_MS) continue;
    const fromMs = Math.max(sorted[i - 1][0], span.fromMs);
    const untilMs = Math.min(sorted[i][0], span.untilMs);
    if (untilMs > fromMs) gaps.push({ fromMs, untilMs });
  }
  return gaps.length === 0 ? undefined : withGaps(span, gaps);
}

/** The figures of a coverage from its gaps; the one place `observedMs + inferredMs` is made. */
export function withGaps(
  span: { fromMs: number; untilMs: number },
  gaps: ReadonlyArray<{ fromMs: number; untilMs: number }>
): StopCoverage {
  const inferredMs = gaps.reduce((sum, g) => sum + (g.untilMs - g.fromMs), 0);
  return { observedMs: span.untilMs - span.fromMs - inferredMs, inferredMs, gaps: [...gaps] };
}

/** A stop clipped to a window: its coverage follows the clip, and goes when no gap is left. */
export function clipCoverage(stop: Stop, fromMs: number, untilMs: number): Stop {
  if (!stop.coverage) return { ...stop, fromMs, untilMs };
  const gaps = stop.coverage.gaps
    .map((g) => ({ fromMs: Math.max(g.fromMs, fromMs), untilMs: Math.min(g.untilMs, untilMs) }))
    .filter((g) => g.untilMs > g.fromMs);
  const { coverage: _dropped, ...rest } = stop;
  return gaps.length === 0
    ? { ...rest, fromMs, untilMs }
    : { ...rest, fromMs, untilMs, coverage: withGaps({ fromMs, untilMs }, gaps) };
}
