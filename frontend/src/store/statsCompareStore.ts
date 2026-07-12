import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Persists the "compare with" year-over-year toggle on the cross-domain
 * Gesamt overview (Stats page) — see issue #188. Before this store
 * existed, `compareEnabled` / `compareYear` lived in `OverviewTab`
 * component state, so both reset to the auto-picked default on every
 * page visit no matter what the user had chosen.
 *
 * `hasSetPreference` distinguishes "no preference recorded yet" from
 * "a preference exists, even if it's off/null". OverviewTab's auto-pick
 * effect (which turns comparison ON by default for a brand-new user
 * with 2+ years of data) only runs while this flag is false — once it
 * fires once, or the user touches the toggle/dropdown themselves, the
 * flag flips true and the persisted values are trusted verbatim on
 * every later visit, including "the user turned it off".
 */
interface StatsCompareState {
  compareEnabled: boolean;
  compareYear: number | null;
  hasSetPreference: boolean;
  setCompareEnabled: (enabled: boolean) => void;
  setCompareYear: (year: number | null) => void;
  /** Sets both fields in one write — used by the auto-pick default. */
  setCompare: (enabled: boolean, year: number | null) => void;
  reset: () => void;
}

const initialState = {
  compareEnabled: false,
  compareYear: null as number | null,
  hasSetPreference: false,
};

export const useStatsCompareStore = create<StatsCompareState>()(
  persist(
    (set) => ({
      ...initialState,
      setCompareEnabled: (enabled) => set({ compareEnabled: enabled, hasSetPreference: true }),
      setCompareYear: (year) => set({ compareYear: year, hasSetPreference: true }),
      setCompare: (enabled, year) =>
        set({ compareEnabled: enabled, compareYear: year, hasSetPreference: true }),
      reset: () => set(initialState),
    }),
    {
      name: "stats-compare-storage",
    }
  )
);
