import { detectClockOffset } from "./clockOffset";
import { assignSegments, sourceAt } from "./handoff";
import { judgeSteps } from "./jumps";
import { rankSources, usable } from "./score";
import type { DayResolution, SourcePoint, TravelEntry, Window } from "./types";

/**
 * The ONE resolution of a day: score every source, pick the segments (or the
 * user's override), judge the resolved stream's jumps against the logbook and
 * look for a clock offset between the two best sources. Pure — the caller has
 * already applied the privacy zones (owner design point 7: before anything).
 */
export function resolveDay(input: {
  window: Window;
  /** The day's points of every origin, time-ordered, privacy zones already applied. */
  points: readonly SourcePoint[];
  entries: readonly TravelEntry[];
  /** The user's choice of origin for the whole day, or null. */
  override: string | null;
}): DayResolution {
  const { window, points, entries, override } = input;
  const all = new Map<string, SourcePoint[]>();
  for (const p of points) all.set(p.origin, [...(all.get(p.origin) ?? []), p]);
  const scores = rankSources(all, window);
  const good = new Map([...all].map(([o, pts]) => [o, pts.filter(usable)]));
  const ranking = scores.filter((s) => s.signals.usable > 0).map((s) => s.source);
  const segments =
    override && all.has(override)
      ? [{ ...window, source: override }]
      : assignSegments(window, good, ranking);
  const stream = points.filter((p) => usable(p) && sourceAt(segments, p.tMs) === p.origin);
  const verdict = judgeSteps(stream, entries);
  const [first, second] = ranking;
  const offsetS = first && second ? detectClockOffset(good.get(first)!, good.get(second)!) : null;
  return {
    segments,
    scores,
    ...verdict,
    mixed: all.size > 1,
    bestScore: scores[0]?.score ?? 0,
    clockOffset: offsetS === null ? null : { source: second, relativeTo: first, offsetS },
  };
}

/** What a read keeps of a day: the stored resolution, reduced to the questions a row asks. */
export type ReadResolution = Window & {
  segments: Array<Window & { source: string }>;
  override: string | null;
  /** The origins the resolution judged; a row of any other arrived since and is kept until it runs again. */
  known: ReadonlySet<string>;
  outlierIds: ReadonlySet<string>;
  breaks: Array<[number, number]>;
  bridges: Array<[number, number]>;
};

/**
 * Whether a stored row is part of the resolved stream. A row on a day nobody
 * resolved yet is kept (the paced derivation has not reached it); a row whose
 * day was resolved is kept only from the source in use at its instant, and not
 * when it is an outlier. A row of a source that arrived after the resolution ran
 * is kept too: the next paced run judges it, and until then nothing is hidden
 * that was never weighed.
 */
export function keepsRow(
  days: readonly ReadResolution[],
  row: { id: string; t: Date; origin: string }
): boolean {
  const tMs = row.t.getTime();
  const day = days.find((d) => tMs >= d.fromMs && tMs < d.untilMs);
  if (!day || !day.known.has(row.origin)) return true;
  if (day.outlierIds.has(row.id)) return false;
  if (day.override) return row.origin === day.override;
  return sourceAt(day.segments, tMs) === row.origin;
}
