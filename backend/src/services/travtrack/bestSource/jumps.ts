import { haversineKm } from "../../../shared/geo/haversine";
import { MAX_MASKED_RUN } from "../../locationEvidence/anomaly";
import { isJumpStep, LONG_GAP_MS } from "./score";
import type { Bridge, SourcePoint, TravelEntry } from "./types";

/**
 * Jumps and long gaps of the resolved stream, read against the logbook first.
 *
 *   - A step that a logged flight, train, ferry or bus explains — its time
 *     window (with slack) overlaps the step, and the step starts near the
 *     entry's departure and ends near its arrival — is a BRIDGE: drawn with
 *     the entry's geometry, never with a straight line through the points.
 *   - An unexplained out-and-back jump (out, at most `MAX_MASKED_RUN` fixes,
 *     back) makes those fixes OUTLIERS: not drawn, not counted.
 *   - An unexplained jump with no way back is a BREAK: which side of it is
 *     wrong cannot be told, so neither is dropped — only the step is neither
 *     drawn nor counted. No route is ever invented for it.
 *
 * A long silence (`LONG_GAP_MS`) an entry explains is a bridge too; any other
 * silence stays a gap, which the day view draws dashed as estimated.
 */

/** How long before departure and after arrival a step may still belong to an entry. */
export const ENTRY_SLACK_MS = 3 * 3_600_000;
/** How far from the entry's ends a step's ends may lie (home to the airport, a coarse fix). */
export const ENTRY_END_KM = 100;
/** Two fitting entries are the same journey only when their ends lie this close. */
export const ENTRY_AGREE_KM = 25;

/** The entry that explains the step `a → b`, or null; ambiguous evidence explains nothing. */
export function explainingEntry(
  a: SourcePoint,
  b: SourcePoint,
  entries: readonly TravelEntry[]
): TravelEntry | null {
  const fits = entries.filter(
    (e) =>
      e.fromMs - ENTRY_SLACK_MS <= b.tMs &&
      e.untilMs + ENTRY_SLACK_MS >= a.tMs &&
      haversineKm(a, e.dep) <= ENTRY_END_KM &&
      haversineKm(b, e.arr) <= ENTRY_END_KM
  );
  if (fits.length === 0) return null;
  // Two entries of the same journey (a codeshare, a duplicate) agree; anything else is ambiguous.
  const first = fits[0];
  const agree = fits.every(
    (e) =>
      e.kind === first.kind &&
      haversineKm(e.dep, first.dep) <= ENTRY_AGREE_KM &&
      haversineKm(e.arr, first.arr) <= ENTRY_AGREE_KM
  );
  return agree ? first : null;
}

export type JumpVerdict = {
  outlierIds: string[];
  breaks: Array<[number, number]>;
  bridges: Bridge[];
};

/** The verdicts on a time-ordered, usable, resolved stream. */
export function judgeSteps(
  points: readonly SourcePoint[],
  entries: readonly TravelEntry[]
): JumpVerdict {
  const bridges: Bridge[] = [];
  const unexplained: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const jump = isJumpStep(a, b);
    if (!jump && b.tMs - a.tMs <= LONG_GAP_MS) continue;
    const entry = explainingEntry(a, b, entries);
    if (entry) {
      bridges.push({
        fromMs: a.tMs,
        untilMs: b.tMs,
        kind: entry.kind,
        entryId: entry.id,
        reason: jump ? "jump" : "gap",
      });
    } else if (jump) unexplained.push(i);
  }
  // Pair an unexplained jump out with one back within a short run: the fixes between are wrong.
  const outlierIds: string[] = [];
  const breaks: Array<[number, number]> = [];
  for (let k = 0; k < unexplained.length; k++) {
    const out = unexplained[k];
    const back = unexplained[k + 1];
    if (back !== undefined && back - out <= MAX_MASKED_RUN) {
      const before = points[out - 1];
      const after = points[back];
      // "Back" means near where it left from: otherwise it is two moves, not a detour.
      if (haversineKm(before, after) < haversineKm(before, points[out])) {
        for (let i = out; i < back; i++) outlierIds.push(points[i].id);
        k++;
        continue;
      }
    }
    breaks.push([points[out - 1].tMs, points[out].tMs]);
  }
  return { outlierIds, breaks, bridges };
}
