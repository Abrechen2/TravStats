/**
 * Timezone Utilities
 *
 * Functions for converting flight times between local airport time and UTC.
 *
 * @deprecated for new code → `shared/time` (ADR 0002). The conversions here
 * are routed through it (`toInstant`, `localDay`, `wallClockParts`) and are
 * deleted in phase 6 once the fake-UTC columns are gone. The provider
 * converters below are library boundaries: they convert through
 * `shared/time` and refuse (`TZ_UNRESOLVED`) instead of guessing UTC.
 */

import { getCachedAirport } from "../services/airportCache";
import { TzUnresolvedError } from "../shared/time/errors";
import { localDay, toInstant, toLocal } from "../shared/time/instant";
import { isValidZone, wallClockParts } from "../shared/time/zonedParts";
import { placeholderDayOf } from "../shared/time/legacyValues";
import logger from "./logger";

export type FlightTimeSemantics = "UTC" | "DATE_ONLY" | "LEGACY_FAKE_UTC" | "UNKNOWN";

/**
 * Calendar date (YYYY-MM-DD) of an instant as seen in `timezone`.
 * Falls back to the UTC date when no timezone is known — stored times are
 * local wall-clock encoded as fake-UTC, so that fallback lands on the right
 * day for same-timezone flights.
 */
export function toLocalDateString(date: Date, timezone: string | null): string {
  return isValidZone(timezone) ? localDay(date, timezone) : date.toISOString().split("T")[0];
}

/** The clock as it read at the airport when the flight left. */
export interface LocalWallClock {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  /** Calendar year. */
  year: number;
  /** 0-11, matching Date#getMonth. */
  month: number;
  /** Day of the month, 1-31. */
  day: number;
  /** 0 = Sunday … 6 = Saturday, matching Date#getDay. */
  weekday: number;
  /** 0-23, or null when the stored time is a DATE_ONLY placeholder. */
  hour: number | null;
}

interface Components {
  year: number;
  /** 1-12, as the formatter reports it. */
  month: number;
  day: number;
  hour: number;
}

/** The stored components read as-is, which is UTC on a Date. */
function storedComponents(stored: Date): Components {
  return {
    year: stored.getUTCFullYear(),
    month: stored.getUTCMonth() + 1,
    day: stored.getUTCDate(),
    hour: stored.getUTCHours(),
  };
}

/** The components on the clock in `timezone`, or null if it is unusable. */
function zonedComponents(stored: Date, timezone: string): Components | null {
  const parts = wallClockParts(stored.getTime(), timezone);
  return parts ? { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour } : null;
}

/**
 * Read a stored flight time as the wall clock at its airport.
 *
 * Every statistic about *when* someone flew has to be answered on that clock:
 * a 07:00 Berlin departure is 05:00 UTC and is a morning flight, not a night
 * one, and a Monday 00:30 departure from Tokyo is Sunday in UTC (#266).
 *
 * Which conversion applies depends on the row's storage semantics, the same
 * split `normalizeFlightTimeUtc` makes:
 *   - 'UTC' / 'DATE_ONLY' / 'UNKNOWN': the stored value is a real instant, so
 *     it is converted through the airport's timezone. UNKNOWN goes here
 *     deliberately — treating it as legacy would shift the API-imported
 *     real-UTC rows that make up most of the untagged set.
 *   - 'LEGACY_FAKE_UTC': the stored components ARE the wall clock, encoded as
 *     UTC. Converting them would subtract the offset a second time.
 * Without a timezone the stored components are the best available reading.
 *
 * DATE_ONLY rows carry a 12:00 placeholder, so `hour` is null for them: the
 * date is real, the time is not.
 *
 * The same reading answers "which countries did I visit in 2025": a 22:30
 * departure from New York on 31 December is already 1 January in UTC, and
 * filing it under the following year would be wrong for the traveller.
 *
 * @deprecated → `toLocal` / `localDay` in `shared/time` once flights store
 * their zone and fake UTC is gone (phases 3 and 6).
 */
export function localWallClockOf(
  stored: Date,
  timezone: string | null | undefined,
  semantics: FlightTimeSemantics = "UNKNOWN"
): LocalWallClock {
  // A year-/month-only placeholder names a day, not an instant: its stored
  // components ARE that day, and a zone would move it (`placeholderDayOf`).
  const placeholder = placeholderDayOf(stored, semantics) !== null;
  const useStored = semantics === "LEGACY_FAKE_UTC" || !timezone || placeholder;
  const { year, month, day, hour } =
    (useStored ? null : zonedComponents(stored, timezone as string)) ?? storedComponents(stored);

  const pad = (n: number): string => String(n).padStart(2, "0");
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    year,
    month: month - 1,
    day,
    // Derived from the local calendar date rather than parsed from a locale
    // weekday name, which would depend on the formatter's language.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    hour: semantics === "DATE_ONLY" || placeholder ? null : hour,
  };
}

/**
 * A flight's departure on its airport's clock, in the zone the flight was
 * STORED with (ADR 0002 phase 4) — never the host's, and never today's
 * catalogue for a flight that has its own.
 */
export function departureClockOf(
  departureTime: Date,
  flight: { depTimezone?: string | null; depTimeSemantics?: string | null }
): LocalWallClock {
  return localWallClockOf(
    departureTime,
    flight.depTimezone,
    (flight.depTimeSemantics as FlightTimeSemantics | null | undefined) || "UNKNOWN"
  );
}

/**
 * Convert a legacy "fake-UTC" timestamp (wall-clock encoded as UTC) into a
 * real UTC instant by re-interpreting the stored components as the airport's
 * local time and applying the airport timezone offset.
 *
 * Example: stored=2026-05-01T10:30:00Z, tz=Europe/Berlin (CEST, UTC+2)
 *          → returns 2026-05-01T08:30:00Z (the real UTC instant of "10:30 Berlin").
 */
export function legacyFakeUtcToRealUtc(stored: Date, tz: string): Date {
  // The stored components ARE the wall clock; reading them off the ISO string
  // avoids any host-local reading. A stored value is a MACHINE wall clock: a
  // reading in a spring-forward gap is placed, not refused, and a repeated
  // hour takes the earlier occurrence (Q5) — date-fns-tz took the later one.
  // An unknown zone throws ZONE_UNKNOWN; it used to return an Invalid Date.
  const wall = stored.toISOString().slice(0, 19);
  return toInstant(wall, tz, { origin: "machine" }).utc;
}

/**
 * Resolve a stored departureTime/arrivalTime to a real UTC instant based on
 * the row's semantics tag. Used by the reminder scheduler and any other
 * consumer that needs absolute time during the legacy-cutover period.
 *
 * - 'UTC':             stored value is already real UTC, return as-is.
 * - 'LEGACY_FAKE_UTC': re-interpret via airport tz; null if tz missing.
 * - 'UNKNOWN':         leave the stored value alone. Treating UNKNOWN as
 *                      LEGACY would wrongly shift API-imported real-UTC
 *                      rows during the post-deploy / pre-backfill window.
 *                      The backfill script is responsible for retagging.
 */
export function normalizeFlightTimeUtc(
  stored: Date | null,
  semantics: FlightTimeSemantics,
  airportTz: string | null
): Date | null {
  if (!stored) return null;
  switch (semantics) {
    case "UTC":
      return stored;
    case "DATE_ONLY":
      return stored;
    case "LEGACY_FAKE_UTC":
      // An unusable zone is the same abstention as a missing one.
      return isValidZone(airportTz) ? legacyFakeUtcToRealUtc(stored, airportTz) : null;
    case "UNKNOWN":
      return stored;
  }
}

/**
 * Calculate the real elapsed flight duration in minutes, accounting for
 * timezones.
 *
 * Behaviour depends on the row's storage semantics:
 *   - 'UTC' (canonical): both endpoints are real UTC instants — naïve diff
 *     is exact, no re-interpretation needed.
 *   - 'LEGACY_FAKE_UTC' / 'UNKNOWN': stored components are wall-clock; we
 *     re-interpret each side through its airport's IANA timezone
 *     (`legacyFakeUtcToRealUtc`) to recover the real elapsed time across
 *     DST/zone hops.
 */
export function tzAwareDurationMinutes(
  departureTime: Date,
  arrivalTime: Date,
  depTz: string | null | undefined,
  arrTz: string | null | undefined,
  depSemantics: FlightTimeSemantics = "UNKNOWN",
  arrSemantics: FlightTimeSemantics = "UNKNOWN"
): number | null {
  // If either side has DATE_ONLY semantics, duration is meaningless (12:00 placeholder)
  if (depSemantics === "DATE_ONLY" || arrSemantics === "DATE_ONLY") {
    return null;
  }

  // Only re-interpret when both sides are explicitly tagged LEGACY. UTC and
  // UNKNOWN both yield naive diff: UTC because the values are already
  // canonical instants; UNKNOWN because treating it as legacy would wrongly
  // shift API-imported real-UTC rows in the pre-backfill window.
  const bothLegacy = depSemantics === "LEGACY_FAKE_UTC" && arrSemantics === "LEGACY_FAKE_UTC";

  if (!bothLegacy || !depTz || !arrTz) {
    return (arrivalTime.getTime() - departureTime.getTime()) / 60_000;
  }

  if (!isValidZone(depTz) || !isValidZone(arrTz)) {
    return (arrivalTime.getTime() - departureTime.getTime()) / 60_000;
  }
  const depUtc = legacyFakeUtcToRealUtc(departureTime, depTz);
  const arrUtc = legacyFakeUtcToRealUtc(arrivalTime, arrTz);
  return (arrUtc.getTime() - depUtc.getTime()) / 60_000;
}

/**
 * Get timezone for an airport by IATA or ICAO code
 * @param airportCode IATA or ICAO code
 * @returns IANA timezone string (e.g., "Europe/Berlin") or null if not found
 */
export async function getAirportTimezone(
  airportCode: string | null | undefined
): Promise<string | null> {
  if (!airportCode) {
    return null;
  }

  try {
    const airport = await getCachedAirport(airportCode);
    return airport?.timezone || null;
  } catch (error) {
    logger.warn({
      operation: "get_airport_timezone_error",
      message: "Failed to get airport timezone",
      context: { airportCode },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
    return null;
  }
}

/** `YYYY-MM-DD[T ]HH:mm[:ss][.sss]` → `YYYY-MM-DDTHH:mm:ss`, or null when it is not one. */
function parseProviderWallClock(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(value.trim());
  return match ? `${match[1]}T${match[2]}:${match[3] ?? "00"}` : null;
}

/**
 * Convert a local time string to UTC based on airport timezone
 * @param timeString Time string (ISO format or any format that Date can parse)
 * @param airportCode IATA or ICAO code of the airport
 * @returns UTC ISO string or null if conversion fails
 */
export async function convertLocalTimeToUtc(
  timeString: string | null | undefined,
  airportCode: string | null | undefined
): Promise<string | null> {
  if (!timeString || !airportCode) {
    return null;
  }

  try {
    const timezone = await getAirportTimezone(airportCode);
    if (!isValidZone(timezone)) {
      // Refused, not read as UTC: an airport's local time read as UTC is off
      // by its whole offset, and nothing downstream could tell.
      throw new TzUnresolvedError(`airport ${airportCode} has no time zone`);
    }

    // Parse the time string as a local time in the airport's timezone
    // If the time string already has timezone info, Date will use that
    // Otherwise, we need to treat it as local time in the airport's timezone
    let localDate: Date;

    // Check if timeString already has timezone information
    if (
      timeString.includes("Z") ||
      timeString.includes("+") ||
      timeString.match(/[+-]\d{2}:\d{2}$/)
    ) {
      // Already has timezone info, parse directly
      localDate = new Date(timeString);
    } else {
      // No offset: the reading is the airport's wall clock. Converted through
      // shared/time — `new Date(dateStr)` read it in the HOST's zone first.
      const wall = parseProviderWallClock(timeString);
      if (!wall) {
        logger.warn({
          operation: "convert_local_time_parse_error",
          message: "Failed to parse time string",
          context: { timeString, airportCode, timezone },
        });
        return null;
      }
      localDate = toInstant(wall, timezone, { origin: "machine" }).utc;
    }

    return localDate.toISOString();
  } catch (error) {
    if (error instanceof TzUnresolvedError) throw error;
    logger.error({
      operation: "convert_local_time_to_utc_error",
      message: "Failed to convert local time to UTC",
      context: { timeString, airportCode },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}

/**
 * Convert UTC time to local airport time
 * @param utcTimeString UTC time string (ISO format)
 * @param airportCode IATA or ICAO code of the airport
 * @returns Local time ISO string or null if conversion fails
 */
export async function convertUtcToLocalTime(
  utcTimeString: string | null | undefined,
  airportCode: string | null | undefined
): Promise<string | null> {
  if (!utcTimeString || !airportCode) {
    return null;
  }

  try {
    const timezone = await getAirportTimezone(airportCode);
    if (!timezone) {
      return utcTimeString; // Return as-is if no timezone found
    }

    const utcDate = new Date(utcTimeString);
    if (isNaN(utcDate.getTime())) {
      return null;
    }

    // The airport's wall clock, written in the fake-UTC form this function
    // always returned on a UTC host. `toZonedTime(...).toISOString()` shifted
    // it by the HOST's offset on any other host.
    if (!isValidZone(timezone)) return utcTimeString;
    return `${toLocal(utcDate, timezone).local}.000Z`;
  } catch (error) {
    logger.error({
      operation: "convert_utc_to_local_time_error",
      message: "Failed to convert UTC to local time",
      context: { utcTimeString, airportCode },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
    return null;
  }
}

/**
 * Convert Aviationstack API time to UTC
 * Aviationstack returns times in local airport time without timezone info
 * @param timeString Time string from Aviationstack API
 * @param airportCode IATA or ICAO code of the airport
 * @returns UTC ISO string or original string if conversion fails
 */
export async function convertAviationstackTimeToUtc(
  timeString: string | null | undefined,
  airportCode: string | null | undefined
): Promise<string | null> {
  if (!timeString || !airportCode) {
    return null;
  }

  // Aviationstack typically returns times like "2025-12-28T14:30:00" (local time, no timezone)
  // We need to interpret this as local time in the airport's timezone
  try {
    const timezone = await getAirportTimezone(airportCode);
    if (!isValidZone(timezone)) {
      logger.warn({
        operation: "convert_aviationstack_time_no_timezone",
        message: "No timezone found for airport, cannot convert Aviationstack time",
        context: { airportCode },
      });
      // Refused rather than parsed as UTC: the value is the airport's wall
      // clock, and reading it as UTC is off by the airport's whole offset.
      throw new TzUnresolvedError(`airport ${airportCode} has no time zone`);
    }

    // Parse the time string (assume it's in local airport time)
    // Remove any timezone info if present
    let cleanTimeString = timeString;
    if (cleanTimeString.includes("Z")) {
      cleanTimeString = cleanTimeString.replace("Z", "");
    }
    if (cleanTimeString.match(/[+-]\d{2}:\d{2}$/)) {
      cleanTimeString = cleanTimeString.replace(/[+-]\d{2}:\d{2}$/, "");
    }

    // Parse the date components
    // Aviationstack observed formats:
    //   "YYYY-MM-DDTHH:mm:ss"   (ISO-ish, with seconds)
    //   "YYYY-MM-DD HH:mm:ss"   (space separator, with seconds)
    //   "YYYY-MM-DD HH:mm"      (space separator, no seconds — observed 2026-04-14)
    const dateMatch = cleanTimeString.match(
      /(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/
    );
    if (!dateMatch) {
      const operation = "convert_aviationstack_time_parse_error";
      logger.warn({
        operation,
        message: "Failed to parse Aviationstack time string format",
        context: { timezone },
      });
      logger.debug({ operation, context: { timeString, airportCode } });
      return null;
    }

    // Extract date components — seconds default to 0 when the format omits them
    const [, year, month, day, hour, minute, second = "0"] = dateMatch;

    // Create a date object with the time components
    // zonedTimeToUtc will interpret this date as if it's in the airport's timezone
    // and convert it to UTC
    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10) - 1; // JavaScript months are 0-indexed
    const dayNum = parseInt(day, 10);
    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);
    const secondNum = parseInt(second, 10);

    // Create a date object using the local time components
    // We create it as if it's in UTC, but zonedTimeToUtc will reinterpret it
    // as if it's in the airport's timezone
    // The key: create the date with UTC components, then zonedTimeToUtc will
    // treat those UTC components as if they were local time in the airport's timezone
    const localDate = new Date(Date.UTC(yearNum, monthNum, dayNum, hourNum, minuteNum, secondNum));

    if (isNaN(localDate.getTime())) {
      const operation = "convert_aviationstack_time_parse_error";
      logger.warn({
        operation,
        message: "Failed to create date from parsed components",
        context: { timezone },
      });
      logger.debug({
        operation,
        context: { timeString, airportCode, year, month, day, hour, minute, second },
      });
      return null;
    }

    // The UTC components of localDate ARE the airport's wall clock; read in
    // the airport's zone: 14:30 in Berlin in December is 13:30Z.
    const wall = localDate.toISOString().slice(0, 19);
    return toInstant(wall, timezone, { origin: "machine" }).utc.toISOString();
  } catch (error) {
    if (error instanceof TzUnresolvedError) throw error;
    logger.error({
      operation: "convert_aviationstack_time_to_utc_error",
      message: "Failed to convert Aviationstack time to UTC",
      context: { timeString, airportCode },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}

/**
 * Convert AirLabs API time to UTC
 * AirLabs returns times in UTC format, but we should verify
 * @param timeString Time string from AirLabs API (usually UTC)
 * @param airportCode IATA or ICAO code (for fallback conversion if needed)
 * @returns UTC ISO string or original string if already UTC
 */
export async function convertAirlabsTimeToUtc(
  timeString: string | null | undefined,
  airportCode?: string | null | undefined
): Promise<string | null> {
  if (!timeString) {
    return null;
  }

  try {
    // AirLabs API typically returns times in UTC format (with 'Z' suffix or UTC offset)
    // Check if it already has timezone info
    if (timeString.includes("Z") || timeString.match(/[+-]\d{2}:\d{2}$/)) {
      // Already has timezone info, parse and return as UTC
      const date = new Date(timeString);
      return isNaN(date.getTime()) ? null : date.toISOString();
    }

    // If no timezone info, try to convert using airport timezone as fallback
    if (airportCode) {
      return await convertAviationstackTimeToUtc(timeString, airportCode);
    }

    // No offset and no airport: a wall clock with no place. `new Date()`
    // would have read it in the HOST's zone; refused instead.
    throw new TzUnresolvedError("an offset-less provider time with no airport");
  } catch (error) {
    if (error instanceof TzUnresolvedError) throw error;
    logger.error({
      operation: "convert_airlabs_time_to_utc_error",
      message: "Failed to convert AirLabs time to UTC",
      context: { timeString, airportCode },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
    return null;
  }
}
