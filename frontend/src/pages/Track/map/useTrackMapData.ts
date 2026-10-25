import { useMemo } from "react";
import type { TrackPoint } from "../../../lib/api/travtrack";
import type { TravTrackRange } from "../../../lib/api/travtrackViews";
import type { DayResult } from "./trackRange";
import { rangeDays } from "./trackRange";
import { dayRangeOf, isLongSpan, type TrackSpan } from "./trackSpan";
import { useRangeDays } from "./useRangeDays";
import { useRangeRead, type RangeReadState } from "./useRangeRead";

type Loaded = Extract<DayResult, { kind: "loaded" }>;

/**
 * What the Track map draws, the same shape whichever read it came from: the
 * safe stretches with the stored point of each vertex, and how many positions
 * stand behind them. A day or a week comes from day reads (with each day's
 * coverage and timeline); a month, a year or a Zeitraum from the range read's
 * parts (simplified, no per-day context). Stretches are listed side by side —
 * neither the days nor the parts are ever joined.
 */
export interface TrackMapSource {
  segments: TrackPoint[][];
  /** Aligned with `segments`; null where an older server named no point. */
  ids: (string | null)[][];
  /** Positions behind the drawing (a simplified range draws fewer). */
  positions: number;
  coverage: Loaded["day"]["coverage"];
}

/** Day reads as a source. */
export function sourceOfDays(loaded: readonly Loaded[]): TrackMapSource {
  return {
    segments: loaded.flatMap((r) => r.day.segments),
    ids: loaded.flatMap(
      (r) => r.day.pointIds ?? r.day.segments.map((s) => s.map((): string | null => null))
    ),
    positions: loaded.reduce((n, r) => n + r.day.pointCount, 0),
    coverage: loaded.flatMap((r) => r.day.coverage),
  };
}

/** Range parts as a source: each part's stretches stay its own. */
export function sourceOfParts(parts: readonly TravTrackRange[]): TrackMapSource {
  return {
    segments: parts.flatMap((p) => p.segments),
    ids: parts.flatMap((p) => p.pointIds),
    positions: parts.reduce((n, p) => n + p.readCount, 0),
    coverage: [],
  };
}

export interface TrackMapData {
  long: boolean;
  days: string[];
  /** Day mode: each day's read. Empty for a long span. */
  dayResults: DayResult[];
  /** Long mode: the range read's state. Null for a day span. */
  range: RangeReadState | null;
  source: TrackMapSource;
  loading: boolean;
  refresh: (date: string) => Promise<void>;
  resume: () => void;
}

export function useTrackMapData(span: TrackSpan, generation: number): TrackMapData {
  const long = isLongSpan(span);
  const { kind, fromDay, toDay } = span;
  const days = useMemo(
    () => (long ? [] : rangeDays(dayRangeOf({ kind, fromDay, toDay }))),
    [long, kind, fromDay, toDay]
  );
  const { results, refresh } = useRangeDays(days, generation);
  const rangeSpan = useMemo(() => (long ? { fromDay, toDay } : null), [long, fromDay, toDay]);
  const { state: range, resume } = useRangeRead(rangeSpan, generation);
  const source = useMemo(() => {
    if (long) return sourceOfParts(range?.parts ?? []);
    return sourceOfDays(results.filter((r): r is Loaded => r.kind === "loaded"));
  }, [long, range, results]);
  const loading = long
    ? range === null || range.kind === "loading"
    : results.some((r) => r.kind === "loading");
  return {
    long,
    days,
    dayResults: long ? [] : results,
    range: long ? range : null,
    source,
    loading,
    refresh,
    resume,
  };
}
