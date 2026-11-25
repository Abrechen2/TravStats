import { LONG_GAP_MS } from "./score";
import type { SourcePoint, SourceSegment, Window } from "./types";

/**
 * Which source is used when, within one day. The best-scoring source is the
 * day's primary; another takes over only where the primary is silent and the
 * other clearly records — phone tracking that begins at noon hands the morning
 * to the Google import, and no more. Two rules keep it from flickering:
 *
 *   - minimum segment: a hand-off shorter than `MIN_SEGMENT_MS` is not made
 *     (the primary's short silence stays a silence);
 *   - hysteresis: once another source has taken over, the primary takes back
 *     only after it records for `MIN_SEGMENT_MS` — a lone primary fix in the
 *     other's stretch does not switch back and forth.
 *
 * Judged on bins of `BIN_MS`; a source covers a bin when it has a fix in it or
 * the bin lies inside one of its steps shorter than `LONG_GAP_MS`.
 */

export const BIN_MS = 15 * 60_000;
export const MIN_SEGMENT_MS = 60 * 60_000;
const MIN_BINS = Math.ceil(MIN_SEGMENT_MS / BIN_MS);

/**
 * Which bins a source covers, swept once over its fixes and short steps: a
 * fix covers the bins within half a bin of it, a step up to `LONG_GAP_MS` the
 * bins it spans. Linear in the points, so a dense 50,000-fix day stays cheap.
 */
function coveredBins(points: readonly SourcePoint[], window: Window, bins: number): boolean[] {
  const out = new Array<boolean>(bins).fill(false);
  const mark = (fromMs: number, untilMs: number) => {
    const a = Math.max(0, Math.floor((fromMs - window.fromMs) / BIN_MS));
    const b = Math.min(bins - 1, Math.floor((untilMs - window.fromMs) / BIN_MS));
    for (let i = a; i <= b; i++) out[i] = true;
  };
  points.forEach((p, i) => {
    mark(p.tMs - BIN_MS / 2, p.tMs + BIN_MS / 2);
    const next = points[i + 1];
    if (next && next.tMs - p.tMs <= LONG_GAP_MS) mark(p.tMs, next.tMs);
  });
  return out;
}

/** Runs of equal values: `[value, start, end)` over bin indexes. */
function runsOf<T>(values: readonly T[]): Array<[T, number, number]> {
  const runs: Array<[T, number, number]> = [];
  values.forEach((v, i) => {
    const last = runs[runs.length - 1];
    if (last && last[0] === v) last[2] = i + 1;
    else runs.push([v, i, i + 1]);
  });
  return runs;
}

/**
 * The day's segments. `ranking` is best first; `byOrigin` holds each source's
 * usable points, time-ordered. A day with one source is one segment.
 */
export function assignSegments(
  window: Window,
  byOrigin: ReadonlyMap<string, readonly SourcePoint[]>,
  ranking: readonly string[]
): SourceSegment[] {
  const primary = ranking[0];
  if (!primary) return [];
  if (ranking.length === 1) return [{ ...window, source: primary }];
  const bins = Math.max(1, Math.ceil((window.untilMs - window.fromMs) / BIN_MS));
  const cover = new Map(ranking.map((o) => [o, coveredBins(byOrigin.get(o) ?? [], window, bins)]));
  const binFrom = (i: number) => window.fromMs + i * BIN_MS;
  const coveredBy = (o: string, i: number) => cover.get(o)![i];

  // 1. Each bin: the best source that records in it, or none.
  const pick: Array<string | null> = Array.from(
    { length: bins },
    (_, i) => ranking.find((o) => coveredBy(o, i)) ?? null
  );
  // 2. Hysteresis: a short primary run inside another source's stretch, where
  //    that source records throughout, stays with that source.
  for (const [value, start, end] of runsOf(pick)) {
    if (value !== primary || end - start >= MIN_BINS) continue;
    const before = pick
      .slice(0, start)
      .reverse()
      .find((v) => v !== null && v !== primary);
    const after = pick.slice(end).find((v) => v !== null && v !== primary);
    if (!before || before !== after) continue;
    let held = true;
    for (let i = start; i < end; i++) held &&= coveredBy(before, i);
    if (held) for (let i = start; i < end; i++) pick[i] = before;
  }
  // 3. Minimum segment: a short stretch of another source is no hand-off.
  for (const [value, start, end] of runsOf(pick)) {
    if (value !== null && value !== primary && end - start < MIN_BINS) {
      for (let i = start; i < end; i++) pick[i] = null;
    }
  }
  // 4. A bin no source records in belongs to the stretch before it (the primary at the start).
  let current: string | null = null;
  const filled = pick.map((v) => (current = v ?? current));
  const firstKnown = filled.find((v) => v !== null) ?? primary;
  const resolved = filled.map((v) => v ?? firstKnown);
  return runsOf(resolved).map(([source, start, end]) => ({
    fromMs: binFrom(start),
    untilMs: end === bins ? window.untilMs : binFrom(end),
    source,
  }));
}

/** The source in use at `tMs`, or null outside every segment. */
export function sourceAt(segments: readonly SourceSegment[], tMs: number): string | null {
  for (const s of segments) if (tMs >= s.fromMs && tMs < s.untilMs) return s.source;
  return null;
}
