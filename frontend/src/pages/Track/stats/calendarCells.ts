import type { TravTrackCalendar } from "../../../lib/api/travtrackViews";
import { dayString, daysInMonth } from "../../../shared/time/calendar";

/**
 * The Statistik calendar's cells (TravTrack plan T5.3): one per day of the
 * year. A day with data carries its ground kilometres (0 is a measurement:
 * recorded, not moved). A day absent from a settled month was not recorded —
 * never a day of zeros. A day of a month still being prepared, or of one
 * whose day values are not known, says so instead of passing for empty.
 */

export type CellState = "recorded" | "none" | "pending" | "unavailable" | "future";

export interface CalendarCell {
  day: string;
  state: CellState;
  /** Kilometres on the ground; null unless recorded. */
  km: number | null;
}

export interface CalendarMonth {
  month: string;
  state: "settled" | "pending" | "unavailable";
  cells: CalendarCell[];
}

export function calendarMonths(data: TravTrackCalendar, today: string): CalendarMonth[] {
  const km = new Map(data.days.map((d) => [d.day, d.kmGround]));
  const pending = new Set(data.pending);
  const unavailable = new Set(data.unavailable);
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const month = `${data.year}-${String(m).padStart(2, "0")}`;
    const state = pending.has(month)
      ? "pending"
      : unavailable.has(month)
        ? "unavailable"
        : "settled";
    const cells = Array.from({ length: daysInMonth(data.year, m) }, (_, d): CalendarCell => {
      const day = dayString(data.year, m, d + 1);
      const value = km.get(day);
      if (value !== undefined) return { day, state: "recorded", km: value };
      if (day > today) return { day, state: "future", km: null };
      if (state === "pending") return { day, state: "pending", km: null };
      if (state === "unavailable") return { day, state: "unavailable", km: null };
      return { day, state: "none", km: null };
    });
    return { month, state, cells };
  });
}

/** The colour steps' lower bounds, km: a sequential ramp of the track's colour. */
export const KM_STEPS = [0, 5, 20, 50, 150] as const;

/** Which step a recorded day's kilometres fall on, 0 … KM_STEPS.length - 1. */
export function kmStep(km: number): number {
  let step = 0;
  for (let i = 0; i < KM_STEPS.length; i++) if (km >= KM_STEPS[i]) step = i;
  return step;
}
