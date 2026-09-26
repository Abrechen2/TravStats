/**
 * The pure halves of the flight form's lookup: what to tell the user when a
 * search found nothing, and which date and time to enter for a picked hit.
 * Split out of useFlightForm.ts (file-size debt, forgejo#59) and testable
 * without rendering the hook.
 */
import type { FlightLookupResponse, LookupAirportSide } from "../../lib/api/flightLookup";
import { apiErrorCode, DEMO_FORBIDDEN_CODE } from "../../lib/apiError";
import { providerFailureLines } from "../../lib/flightLookupFailure";
import { formatWallClockIn } from "../../shared/zonedWallClock";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The server's code for a search that ran and found nothing → i18n key. */
const EMPTY_RESULT_KEYS: Record<string, string> = {
  LOOKUP_NOT_CONFIGURED: "errors:lookupNotConfigured",
  LOOKUP_UNAVAILABLE: "errors:lookupOutsideLiveWindow",
  NO_FLIGHT_DATA_API_GAP: "errors:noFlightDataApiGap",
  NO_FLIGHT_DATA_FOR_DATE: "errors:noFlightDataForDate",
};

/** Why a search that answered 200 returned no flight. */
export function lookupEmptyMessage(body: FlightLookupResponse<unknown>, t: Translate): string {
  if (body.error === "LOOKUP_PROVIDER_FAILED") {
    return [
      t("errors:lookupProviderFailed"),
      ...providerFailureLines(body.providerFailures ?? [], t),
    ].join(" ");
  }
  const key = body.error ? EMPTY_RESULT_KEYS[body.error] : undefined;
  return t(key ?? "errors:noFlightsFound");
}

/**
 * Why the search request itself failed. A 429 used to read "enter an API key"
 * and the demo account's 403 "no flights found"; neither was true.
 */
export function lookupRequestErrorMessage(err: unknown, t: Translate): string {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === 429) return t("errors:lookupRateLimited");
  if (status === 403 && apiErrorCode(err) === DEMO_FORBIDDEN_CODE) {
    return t("errors:lookupDemoForbidden");
  }
  return t("errors:lookupFailed");
}

export interface WallClock {
  date: string;
  time: string;
}

const LOCAL_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

/** Through `shared/zonedWallClock.ts`, the one home for "instant to wall clock". */
function wallClockIn(instant: Date, timezone: string): WallClock | null {
  const wall = formatWallClockIn(instant, timezone);
  return wall ? { date: wall.slice(0, 10), time: wall.slice(11, 16) } : null;
}

/**
 * The wall clock at the airport for one side of a hit.
 *
 * `scheduledTime` is a UTC instant; cutting "HH:MM" out of its text entered
 * LH400's 13:25 Frankfurt departure as 11:25. The server's own reading
 * (`scheduledLocal`) wins; else the instant is converted in the airport's zone;
 * a zone-less string is already a wall clock. An instant whose airport zone is
 * unknown abstains (null) rather than borrowing the browser's clock.
 */
export function lookupWallClock(
  side: LookupAirportSide | undefined,
  airportTimezone?: string | null
): WallClock | null {
  if (!side) return null;
  const local = side.scheduledLocal ? LOCAL_PATTERN.exec(side.scheduledLocal) : null;
  if (local) return { date: local[1], time: local[2] };
  const raw = side.scheduledTime;
  if (!raw) return null;
  if (HAS_ZONE.test(raw)) {
    const zone = side.timezone ?? airportTimezone;
    const instant = new Date(raw);
    return zone && !Number.isNaN(instant.getTime()) ? wallClockIn(instant, zone) : null;
  }
  const naive = LOCAL_PATTERN.exec(raw);
  return naive ? { date: naive[1], time: naive[2] } : null;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD), independent of any zone. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

export interface LookupFormTimes {
  departureDate?: string;
  departureTime?: string;
  arrivalDate?: string;
  arrivalTime?: string;
}

/**
 * The four form fields for a picked hit. With a search date the departure day
 * is the one the user asked for, and the arrival moves by the same number of
 * days — an overnight flight keeps landing the day after. Pure calendar
 * arithmetic: the browser's own zone is never consulted.
 */
export function lookupFormTimes(
  dep: WallClock | null,
  arr: WallClock | null,
  searchDate: string
): LookupFormTimes {
  const shift = searchDate && dep ? daysBetween(dep.date, searchDate) : 0;
  return {
    departureDate: searchDate || dep?.date,
    departureTime: dep?.time,
    arrivalDate: arr ? addDays(arr.date, shift) : undefined,
    arrivalTime: arr?.time,
  };
}
