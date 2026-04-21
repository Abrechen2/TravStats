import { create } from "zustand";

export interface TimeRange {
  readonly from: string | null; // ISO yyyy-mm-dd
  readonly to: string | null;
}

export interface FlightFilter {
  readonly airline?: string;
  readonly status?: string;
}

export interface CruiseFilter {
  readonly cruiseLine?: string;
  readonly status?: string;
}

export interface PoiFilter {
  readonly category?: string;
}

interface DashboardFilterState {
  time: TimeRange;
  flight: FlightFilter;
  cruise: CruiseFilter;
  poi: PoiFilter;
  /**
   * Fully replaces the global time filter. Callers must guarantee
   * `from <= to` — inverted ranges are not normalised here. The
   * filter dropdown (Task 17) enforces ordering at input time.
   */
  setTimeRange(from: string | null, to: string | null): void;
  setFlightFilter(patch: Partial<FlightFilter>): void;
  setCruiseFilter(patch: Partial<CruiseFilter>): void;
  setPoiFilter(patch: Partial<PoiFilter>): void;
  reset(): void;
}

const EMPTY_TIME: TimeRange = { from: null, to: null };

export const useDashboardFilterStore = create<DashboardFilterState>((set) => ({
  time: EMPTY_TIME,
  flight: {},
  cruise: {},
  poi: {},
  setTimeRange: (from, to) => set({ time: { from, to } }),
  setFlightFilter: (patch) => set((s) => ({ flight: { ...s.flight, ...patch } })),
  setCruiseFilter: (patch) => set((s) => ({ cruise: { ...s.cruise, ...patch } })),
  setPoiFilter: (patch) => set((s) => ({ poi: { ...s.poi, ...patch } })),
  reset: () => set({ time: EMPTY_TIME, flight: {}, cruise: {}, poi: {} }),
}));

/**
 * True when the interval [startDate, endDate] overlaps the filter range
 * [from, to]. Used for cruise time-filtering where each cruise is an
 * interval and the global time-slider is also a range. Null `endDate`
 * means open-ended cruise (treated as still ongoing). Null `from` / `to`
 * means that bound is unset.
 */
export function intervalOverlapsRange(
  startDate: string,
  endDate: string | null,
  from: string | null,
  to: string | null
): boolean {
  const toNumber = (v: string | null, fallback: number): number => {
    if (v === null) return fallback;
    const n = Date.parse(v);
    return Number.isNaN(n) ? fallback : n;
  };
  const start = toNumber(startDate, Number.NEGATIVE_INFINITY);
  const end = toNumber(endDate, Number.POSITIVE_INFINITY);
  const rangeFrom = toNumber(from, Number.NEGATIVE_INFINITY);
  const rangeTo = toNumber(to, Number.POSITIVE_INFINITY);
  return start <= rangeTo && end >= rangeFrom;
}
