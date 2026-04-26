import { create } from "zustand";

/**
 * Globe time-slider state. Three modes:
 *
 *   off     — no filtering, no animation, sun direction = real now.
 *   live    — storytelling: a single cursor scrubs through time. Arcs
 *             appear at their start date and ships "walk" along their
 *             route as the cursor crosses leg start/end. Sun direction
 *             follows the cursor.
 *   filter  — a [start, end] window. Only items whose date overlaps the
 *             window are drawn. Sun direction sits at the end of the
 *             window so the visible scene is internally consistent.
 *
 * `rangeMin` / `rangeMax` are derived from the actual flight + cruise
 * data each time the slider opens — see `computeTimeRange` in
 * `components/Globe/timeSliderUtils.ts`. Until they're set the slider
 * stays disabled (the toggle still works but rendering won't change).
 */

export type TimeSliderMode = "off" | "live" | "filter";

/** Speed multiplier in *days per real-time second*. 30 = a month
 * scrubs past every second of wall-clock time. The choices are tuned
 * for a 5-15 year history: at 30 d/s a full decade plays in ~2 min,
 * at 365 d/s in ~10 s. */
export type TimeSliderSpeed = 7 | 30 | 90 | 365;

interface TimeSliderState {
  mode: TimeSliderMode;
  rangeMin: Date | null;
  rangeMax: Date | null;
  currentDate: Date | null;
  isPlaying: boolean;
  speed: TimeSliderSpeed;
  filterStart: Date | null;
  filterEnd: Date | null;

  setMode: (mode: TimeSliderMode) => void;
  setRange: (min: Date, max: Date) => void;
  setCurrentDate: (d: Date) => void;
  setPlaying: (p: boolean) => void;
  togglePlaying: () => void;
  setSpeed: (s: TimeSliderSpeed) => void;
  setFilterRange: (start: Date, end: Date) => void;
  reset: () => void;
}

const DEFAULT_SPEED: TimeSliderSpeed = 30;

const clamp = (d: Date, min: Date | null, max: Date | null): Date => {
  if (min && d.getTime() < min.getTime()) return new Date(min.getTime());
  if (max && d.getTime() > max.getTime()) return new Date(max.getTime());
  return d;
};

export const useTimeSliderStore = create<TimeSliderState>()((set, get) => ({
  mode: "off",
  rangeMin: null,
  rangeMax: null,
  currentDate: null,
  isPlaying: false,
  speed: DEFAULT_SPEED,
  filterStart: null,
  filterEnd: null,

  setMode: (mode) => {
    const { rangeMin, rangeMax, currentDate, filterStart, filterEnd } = get();
    if (mode === "live") {
      // Seed cursor at rangeMin if nothing's been scrubbed yet so the
      // animation plays forward from the earliest trip — same gesture
      // as opening a video and seeing it cued at frame zero.
      const seed = currentDate ?? rangeMin;
      set({ mode, currentDate: seed, isPlaying: false });
    } else if (mode === "filter") {
      const start = filterStart ?? rangeMin;
      const end = filterEnd ?? rangeMax;
      set({ mode, filterStart: start, filterEnd: end, isPlaying: false });
    } else {
      set({ mode, isPlaying: false });
    }
  },

  setRange: (min, max) => {
    const prev = get();
    // Only re-seed when the bounds actually change. Re-running on every
    // GlobeView render would yank the cursor back to rangeMin every
    // time the data identity flickered.
    if (prev.rangeMin?.getTime() === min.getTime() && prev.rangeMax?.getTime() === max.getTime()) {
      return;
    }
    set({
      rangeMin: min,
      rangeMax: max,
      currentDate: prev.currentDate ? clamp(prev.currentDate, min, max) : null,
      filterStart: prev.filterStart ? clamp(prev.filterStart, min, max) : null,
      filterEnd: prev.filterEnd ? clamp(prev.filterEnd, min, max) : null,
    });
  },

  setCurrentDate: (d) => {
    const { rangeMin, rangeMax } = get();
    set({ currentDate: clamp(d, rangeMin, rangeMax) });
  },

  setPlaying: (p) => set({ isPlaying: p }),
  togglePlaying: () => set((s) => ({ isPlaying: !s.isPlaying })),

  setSpeed: (s) => set({ speed: s }),

  setFilterRange: (start, end) => {
    const { rangeMin, rangeMax } = get();
    const lo = clamp(start, rangeMin, rangeMax);
    const hi = clamp(end, rangeMin, rangeMax);
    // Always store [lo, hi] in ascending order even if the user dragged
    // the right thumb past the left one.
    if (lo.getTime() > hi.getTime()) {
      set({ filterStart: hi, filterEnd: lo });
    } else {
      set({ filterStart: lo, filterEnd: hi });
    }
  },

  reset: () =>
    set({
      mode: "off",
      currentDate: null,
      isPlaying: false,
      filterStart: null,
      filterEnd: null,
      speed: DEFAULT_SPEED,
    }),
}));
