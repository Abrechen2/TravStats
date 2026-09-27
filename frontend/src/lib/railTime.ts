/**
 * Rail times are read on the STATION's clock (spec 2026-09-25-rail-domain):
 * everything the user sees is the wall clock printed on the ticket, never the
 * viewer's own.
 *
 * Since phase 4 of the time model (ADR 0002) the server sends that clock
 * itself (`times.departure.local`), and these helpers only dress a
 * `TimeValue` for the screen — they hold no zone logic. `lib/entityTimes.ts`
 * turns a journey (or a lookup leg) into its `TimeValue`s; a station the
 * server could not place reads on the UTC clock and is labelled "UTC" rather
 * than passed off as station time.
 */
import { clockOf, formatTimeValue, readsAsUtc, type TimeValue } from "../shared/time";
import { railArrival, railDeparture, type RailLike } from "./entityTimes";

/** `YYYY-MM-DDTHH:mm` on the station's clock — what a `datetime-local` input takes. */
export function toStationWallClock(value: TimeValue | null | undefined): string {
  return value ? value.local.slice(0, 16) : "";
}

const utcMark = (value: TimeValue): string => (readsAsUtc(value) ? " UTC" : "");

/** Date and time for display, on the station's clock, in the reader's locale. */
export function formatStationTime(value: TimeValue, locale: string): string {
  return `${formatTimeValue(value, locale)}${utcMark(value)}`;
}

/** The clock alone, for the arrival beside a departure on the same row. */
export function formatStationClock(value: TimeValue, locale: string): string {
  const clock = clockOf(value);
  if (!clock) return "";
  const [h, m] = clock.split(":").map(Number);
  const text = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, 0, 1, h, m))
  );
  return `${text}${utcMark(value)}`;
}

/**
 * Minutes on board, from the two instants (`utc`) — so a ride across a zone
 * border is measured right. Null when the arrival is not known or precedes
 * the departure: an unknown duration is not zero.
 */
export function railDurationMinutes(
  departure: TimeValue,
  arrival: TimeValue | null | undefined
): number | null {
  if (!arrival) return null;
  const minutes = Math.round((Date.parse(arrival.utc) - Date.parse(departure.utc)) / 60_000);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

/**
 * "15.01.2026, 08:00 – 12:10": the departure on its station's clock and the
 * arrival's clock beside it, for a list row, a card or a booking leg.
 */
export function formatRailSpan(journey: RailLike, locale: string, separator = " – "): string {
  const departure = railDeparture(journey);
  const arrival = railArrival(journey);
  if (!departure) return "";
  const from = formatStationTime(departure, locale);
  return arrival ? `${from}${separator}${formatStationClock(arrival, locale)}` : from;
}
