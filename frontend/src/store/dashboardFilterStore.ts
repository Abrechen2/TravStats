import { create } from "zustand";

export interface TimeRange {
  from: string | null; // ISO yyyy-mm-dd
  to: string | null;
}

export interface FlightFilter {
  airline?: string;
  status?: string;
}

export interface CruiseFilter {
  cruiseLine?: string;
  status?: string;
}

export interface PoiFilter {
  category?: string;
}

interface DashboardFilterState {
  time: TimeRange;
  flight: FlightFilter;
  cruise: CruiseFilter;
  poi: PoiFilter;
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
  const start = Date.parse(startDate);
  const end = endDate === null ? Number.POSITIVE_INFINITY : Date.parse(endDate);
  const rangeFrom = from === null ? Number.NEGATIVE_INFINITY : Date.parse(from);
  const rangeTo = to === null ? Number.POSITIVE_INFINITY : Date.parse(to);
  return start <= rangeTo && end >= rangeFrom;
}
