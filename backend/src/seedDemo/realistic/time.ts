import { wallClockToInstant } from "../../services/rail/railJourneyWrite";
import { zoneOf } from "../../shared/time/zoneOf";

/**
 * Dates of the demo account, always relative to the run's own "now".
 *
 * A fixed date is how the old seed went stale: every nightly reseed of a
 * public instance produced "upcoming" journeys that had already happened
 * (finding B6 of the independent review of 2026-09-17). A trip here is either
 * N whole years before the current one — always in the past, whatever the day
 * — or N days from today, which is how the current year and the planned trips
 * stay current and upcoming for as long as the account exists.
 */

export type Anchor = { yearsAgo: number; month: number; day: number } | { daysFromNow: number };

const DAY_MS = 86_400_000;

/** The trip's first day, as UTC midnight. */
export function anchorDay(anchor: Anchor, now: Date): Date {
  if ("daysFromNow" in anchor) {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return new Date(today + anchor.daysFromNow * DAY_MS);
  }
  return new Date(Date.UTC(now.getUTCFullYear() - anchor.yearsAgo, anchor.month - 1, anchor.day));
}

export function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * DAY_MS);
}

/** `YYYY-MM-DD` of a UTC-midnight day. */
export function isoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/**
 * The instant a local clock reads `hhmm` on `day + offset` at a place. A clock
 * written `+1 06:40` is the next calendar day — an overnight arrival.
 */
export function localInstant(day: Date, clock: string, place: { lat: number; lon: number }): Date {
  const next = clock.startsWith("+");
  const [dayShift, hhmm] = next
    ? [Number(clock.slice(1, clock.indexOf(" "))), clock.slice(clock.indexOf(" ") + 1)]
    : [0, clock];
  const date = isoDay(addDays(day, dayShift));
  return wallClockToInstant(`${date}T${hhmm}`, zoneOf(place));
}

/** Whole minutes between two instants. */
export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}
