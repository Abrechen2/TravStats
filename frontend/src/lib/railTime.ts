/**
 * Rail times are read on the STATION's clock (spec 2026-09-25-rail-domain):
 * the server stores the real instant and the zone it derived from the
 * station's coordinates, and everything the user sees is that zone's wall
 * clock — the time printed on the ticket — never the viewer's own.
 *
 * A null zone (the server could not place the station) means the instant was
 * stored as the wall clock read as UTC, so UTC is the honest way back.
 */

import { formatWallClockIn } from "../shared/zonedWallClock";

/**
 * `YYYY-MM-DDTHH:mm` on the station's clock — what a `datetime-local` input
 * takes. Read through `shared/zonedWallClock.ts`, the one home for "instant to
 * wall clock"; a zone the runtime rejects reads as UTC, like a missing one.
 */
export function toStationWallClock(iso: string | null, timeZone: string | null): string {
  if (!iso) return "";
  const instant = new Date(iso);
  const wall = formatWallClockIn(instant, timeZone ?? "UTC") ?? formatWallClockIn(instant, "UTC");
  return wall ? wall.slice(0, 16) : "";
}

/** Date and time for display, on the station's clock, in the reader's locale. */
export function formatStationTime(iso: string, timeZone: string | null, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timeZone ?? "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** The clock alone, for the arrival beside a departure on the same row. */
export function formatStationClock(iso: string, timeZone: string | null, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timeZone ?? "UTC",
    timeStyle: "short",
  }).format(new Date(iso));
}

/**
 * Minutes on board, from the two instants — both are real UTC instants, so a
 * ride across a zone border is measured right. Null when the arrival is not
 * known or precedes the departure: an unknown duration is not zero.
 */
export function railDurationMinutes(
  departureIso: string,
  arrivalIso: string | null
): number | null {
  if (!arrivalIso) return null;
  const minutes = Math.round((Date.parse(arrivalIso) - Date.parse(departureIso)) / 60_000);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}
