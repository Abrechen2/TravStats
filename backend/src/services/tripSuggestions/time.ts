import logger from "../../utils/logger";
import { zoneOf } from "../../shared/time/zoneOf";
import { localWallClockOf, type FlightTimeSemantics } from "../../utils/timezone";
import { now as clockNow } from "../../shared/time/clock";
import { localDay } from "../../shared/time/instant";
import { isValidZone } from "../../shared/time/zonedParts";

/**
 * Every time question the trip-suggestion engine asks, in one file — so that
 * moving the engine onto `shared/time/` (ADR 0002, phase 1) is one file's work.
 *
 * The rules this file keeps (ADR 0002, D4):
 * - "Which day" is the PLACE's local day: an airport's or a station's zone for
 *   an instant, and the stored calendar day for a day column (a stay, a cruise
 *   day, a station, a trip), which already IS the place's day.
 * - "Today" — and with it "past or planned" for a dated station — is the
 *   user's PROFILE zone.
 * - Day arithmetic works on `YYYY-MM-DD` keys only; no host-local getter and
 *   no `new Date(y, m, d)` anywhere in the engine.
 * - A zone that is not known is never replaced by UTC in silence: the point is
 *   read on its UTC day and marked `zoneKnown: false`, and a proposal that
 *   holds such an entry says so (`TripSuggestion.zoneUnknown`).
 */

const DAY_MS = 86_400_000;

/** Days since the epoch for a `YYYY-MM-DD` key — arithmetic, not a calendar in any zone. */
export function dayNumber(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

/** `b - a` in whole days. */
export function dayDiff(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

export function addDays(day: string, n: number): string {
  return new Date((dayNumber(day) + n) * DAY_MS).toISOString().slice(0, 10);
}

/** Every day from `startDay` up to, not including, `endDay` — the nights of a stay. */
export function daysBetween(startDay: string, endDay: string): string[] {
  const out: string[] = [];
  for (let day = startDay; day < endDay; day = addDays(day, 1)) out.push(day);
  return out;
}

/**
 * The day a DAY column holds. Stays, cruises, cruise stops, roadtrip stations,
 * place visits and trips store a calendar day (or a local wall clock) as UTC
 * midnight, so its UTC date is the place's day — no zone is applied, and none
 * must be (ADR 0002, D1).
 */
export function storedDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** A day key back into the column shape the day columns use (UTC midnight). */
export function dayColumn(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/**
 * The zone of a place the engine reads an instant at, through the one
 * resolver (ADR 0002, D2): the catalogue row's zone when Intl knows it, the
 * coordinates otherwise. Null only when neither can answer; a resolver that
 * cannot run throws `TIMEZONE_LOOKUP_UNAVAILABLE` instead of letting a day be read in UTC.
 */
export function placeZone(
  catalogueZone: string | null | undefined,
  lat: number | null | undefined,
  lon: number | null | undefined
): string | null {
  return zoneOf({ catalogueZone, lat, lon });
}

/**
 * The place-local day and hour of an INSTANT (a departure, an arrival).
 *
 * `DATE_ONLY` and `LEGACY_FAKE_UTC` rows store the local wall clock already
 * and need no zone. Any other instant needs the place's zone; without it the
 * UTC day is used and `zoneKnown` says it is only approximate.
 */
export function placeClock(
  at: Date,
  zone: string | null,
  semantics: FlightTimeSemantics,
  fallbackHour: number
): { day: string; hour: number; zoneKnown: boolean } {
  const storedIsLocal = semantics === "DATE_ONLY" || semantics === "LEGACY_FAKE_UTC";
  if (!zone && !storedIsLocal) {
    return { day: storedDay(at), hour: at.getUTCHours(), zoneKnown: false };
  }
  const clock = localWallClockOf(at, zone, semantics);
  return { day: clock.date, hour: clock.hour ?? fallbackHour, zoneKnown: true };
}

/**
 * Today in the user's profile zone. Without one the server's UTC day stands
 * in — the one fallback here, and it is the USER's zone that is missing, not a
 * place's; the web writes the profile zone on first use.
 */
export function todayIn(profileZone: string | null, now: Date = clockNow()): string {
  if (profileZone && isValidZone(profileZone)) return localDay(now, profileZone);
  if (profileZone) {
    // An unknown zone name in the profile: said in the log, and the same day
    // the server uses stands in rather than failing the whole inbox.
    logger.warn({ profileZone }, "[TripSuggestions] Unknown profile zone");
  }
  return storedDay(now);
}
