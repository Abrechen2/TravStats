import { useEffect, useState } from "react";
import { useStatsCompareStore } from "../../store/statsCompareStore";
import { resolveStaleCompareYear } from "./Overview/aggregate";

export interface StatsPeriod {
  selectedYear: number | null;
  compareYear: number | null;
  compareEnabled: boolean;
  setSelectedYear: (year: number | null) => void;
  setCompareYear: (year: number) => void;
  setCompareEnabled: (enabled: boolean) => void;
  /** The same period, as the domain tabs consume it. */
  scope: PeriodScope;
}

/**
 * What a domain tab needs to know: which year, and which year to set it
 * against. `compareYear` is non-null ONLY while a comparison is really on — the
 * store keeps a remembered compare year while the toggle is off (#188), and a
 * tab reading that raw value would draw a comparison nobody asked for.
 */
export interface PeriodScope {
  year: number | null;
  compareYear: number | null;
}

/**
 * The statistics period, owned once for the whole page.
 *
 * It used to be owned twice: the Gesamt tab had this state, the flights tab
 * had its own, and the cruise, lodging and POI tabs had none at all. So the
 * overview said "no stays in 2026" while the lodging tab beside it showed a
 * lifetime total — two right numbers that contradict each other, which is
 * what the owner reported on 2026-09-15.
 *
 * The logic is the Gesamt tab's, moved rather than rewritten, because each
 * part of it was paid for:
 *
 * - The most recent year is picked ONCE, after data lands. After that the
 *   reader owns the choice — clicking "Alle Jahre" must not snap back.
 * - `compareEnabled` / `compareYear` are persisted (#188), so the choice
 *   survives a revisit. The auto-pick only fires while the reader has never
 *   set a preference; once they have, even "off" sticks.
 * - A stale compare year is resolved rather than rendered: it can vanish from
 *   the dataset, or equal the selected year (a delta against itself), or
 *   there can be fewer than two years at all.
 *
 * The stale check must NOT run before data has loaded. While `loading` is
 * true, `years` is empty, which makes every persisted compare year look stale
 * and would wipe the reader's saved preference before it was ever judged
 * against a real year list.
 */
export function useStatsPeriod(years: number[], loading: boolean): StatsPeriod {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [didAutoPick, setDidAutoPick] = useState(false);

  const compareYear = useStatsCompareStore((s) => s.compareYear);
  const compareEnabled = useStatsCompareStore((s) => s.compareEnabled);
  const hasSetComparePreference = useStatsCompareStore((s) => s.hasSetPreference);
  const setCompareYear = useStatsCompareStore((s) => s.setCompareYear);
  const setCompareEnabled = useStatsCompareStore((s) => s.setCompareEnabled);
  const setCompare = useStatsCompareStore((s) => s.setCompare);

  useEffect(() => {
    if (didAutoPick || years.length === 0) return;
    setSelectedYear(years[years.length - 1]);
    if (!hasSetComparePreference && years.length >= 2) {
      setCompare(true, years[years.length - 2]);
    }
    setDidAutoPick(true);
  }, [years, didAutoPick, hasSetComparePreference, setCompare]);

  useEffect(() => {
    if (loading || years.length === 0) return;
    const resolution = resolveStaleCompareYear(years, selectedYear, compareYear);
    if (!resolution) return;
    setCompareYear(resolution.compareYear);
    if (resolution.disableCompare) setCompareEnabled(false);
  }, [loading, years, compareYear, selectedYear, setCompareYear, setCompareEnabled]);

  return {
    selectedYear,
    compareYear,
    compareEnabled,
    setSelectedYear,
    setCompareYear,
    setCompareEnabled,
    scope: {
      year: selectedYear,
      compareYear: compareEnabled && selectedYear !== null ? compareYear : null,
    },
  };
}
