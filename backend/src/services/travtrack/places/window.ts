import { wallClockParts } from "../../../shared/time/zonedParts";

/**
 * The weekly window of a fixed place (spec 2026-11-05-travtrack-fixed-places):
 * `days` are ISO weekdays (1 = Monday .. 7 = Sunday) the window STARTS on,
 * `from`/`until` are wall-clock times in the place's own zone. `until` earlier
 * than `from` spans midnight, so "Mon 22:00 - 06:00" also holds Tuesday 03:00.
 *
 * Host-local `Date` getters are forbidden here (ADR 0002, D6): the wall clock
 * comes from `shared/time` and the weekday from the calendar date it reports.
 */

export type FixedPlaceWindow = { days: number[]; from: string; until: string };

export const WINDOW_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutesOf = (hhmm: string): number =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** ISO weekday of a calendar date; arithmetic on the date alone, no zone involved. */
function isoWeekday(year: number, month: number, day: number): number {
  const sunday0 = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return sunday0 === 0 ? 7 : sunday0;
}

/**
 * Whether the instant lies inside the window on the zone's clock. A zone the
 * runtime does not know abstains: false, never "always".
 */
export function insideWindow(instantMs: number, zone: string, window: FixedPlaceWindow): boolean {
  const parts = wallClockParts(instantMs, zone);
  if (!parts) return false;
  const minute = parts.hour * 60 + parts.minute;
  const from = minutesOf(window.from);
  const until = minutesOf(window.until);
  const today = isoWeekday(parts.year, parts.month, parts.day);
  if (from < until) return window.days.includes(today) && minute >= from && minute < until;
  if (from === until) return false;
  // Across midnight: the evening part belongs to today's start, the morning part to yesterday's.
  if (minute >= from) return window.days.includes(today);
  if (minute < until) return window.days.includes(today === 1 ? 7 : today - 1);
  return false;
}
