import { create } from "zustand";

export interface DashboardCounts {
  flight: number;
  cruise: number;
  poi: number;
  lodging: number;
  rail: number;
}

export interface DashboardScheduledCounts {
  flight: number;
  cruise: number;
}

const INITIAL_COUNTS: DashboardCounts = { flight: 0, cruise: 0, poi: 0, lodging: 0, rail: 0 };
const INITIAL_SCHEDULED_COUNTS: DashboardScheduledCounts = { flight: 0, cruise: 0 };

interface DashboardCountsState {
  counts: DashboardCounts;
  scheduledCounts: DashboardScheduledCounts;
  /** True once the counts fetch has resolved at least once. */
  countsLoaded: boolean;
  setCounts: (counts: DashboardCounts, scheduledCounts: DashboardScheduledCounts) => void;
  reset: () => void;
}

/**
 * Counts live here, not in `DashboardPage` state, because `App.tsx` keys its
 * animated `Routes` on `location.pathname` (#alex-design-feedback task 2):
 * `/dashboard/flights` -> `/dashboard/cruises` changes the pathname, so
 * `DashboardPage` remounts on every tab change. A `useState` there would
 * reset to zero and refetch on each switch, and `DomainTabStrip` renders the
 * badge for any non-null count -- so the strip flashed "0" on every tab
 * change (reported by the tester as the tab strip "jumping"). A module-level
 * Zustand store survives the remount: the effect below still refetches for
 * freshness, but the badge shows the last known number while that fetch is
 * in flight instead of a momentary zero.
 */
export const useDashboardCountsStore = create<DashboardCountsState>((set) => ({
  counts: INITIAL_COUNTS,
  scheduledCounts: INITIAL_SCHEDULED_COUNTS,
  countsLoaded: false,
  setCounts: (counts, scheduledCounts) => set({ counts, scheduledCounts, countsLoaded: true }),
  reset: () =>
    set({ counts: INITIAL_COUNTS, scheduledCounts: INITIAL_SCHEDULED_COUNTS, countsLoaded: false }),
}));
