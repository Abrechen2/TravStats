/**
 * Why a calendar could not be read (spec 2026-11-23-plugins-and-calendar.md,
 * Part A). The kinds are Immich's fixed vocabulary, so the settings page maps
 * them the same way (`notConfigured | unreachable | auth | notFound | protocol
 * | invalidUrl`); the `code` beside a kind says which case it was where one
 * kind covers several (a private target is `invalidUrl` with `PRIVATE_TARGET`,
 * an oversized feed is `protocol` with `CALENDAR_TOO_LARGE`).
 */
import { BoundedFetchError } from "../egress/boundedFetch";
import { EgressBlockedError } from "../externalServices/egress";

export const CALENDAR_FAILURE_KINDS = [
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
  "invalidUrl",
] as const;
export type CalendarFailureKind = (typeof CALENDAR_FAILURE_KINDS)[number];

export const CALENDAR_FAILURE_CODES = [
  "PRIVATE_TARGET",
  "CALENDAR_TIMEOUT",
  "CALENDAR_TOO_LARGE",
  "CALENDAR_TOO_MANY_EVENTS",
  "CALENDAR_PARSE",
  "CALENDAR_PARSE_TIMEOUT",
  "CALENDAR_REDIRECT",
  "CALENDAR_XML_TOO_DEEP",
  "CALENDAR_FOREIGN_HREF",
  "CALENDAR_NO_COLLECTIONS",
  "CALENDAR_EGRESS_INTERNET_OFF",
  "CALENDAR_EGRESS_SERVICE_OFF",
] as const;
export type CalendarFailureCode = (typeof CALENDAR_FAILURE_CODES)[number];

export class CalendarError extends Error {
  constructor(
    readonly kind: CalendarFailureKind,
    readonly code: CalendarFailureCode | null = null
  ) {
    super(`Calendar failed: ${kind}${code ? ` (${code})` : ""}`);
    this.name = "CalendarError";
  }
}

/** A bounded-fetch failure in the calendar's vocabulary. */
export function calendarErrorOfFetch(error: BoundedFetchError): CalendarError {
  switch (error.reason) {
    case "privateTarget":
      return new CalendarError("invalidUrl", "PRIVATE_TARGET");
    case "invalidUrl":
      return new CalendarError("invalidUrl");
    case "timeout":
      return new CalendarError("unreachable", "CALENDAR_TIMEOUT");
    case "tooLarge":
      return new CalendarError("protocol", "CALENDAR_TOO_LARGE");
    default:
      return new CalendarError("unreachable");
  }
}

/** Any error of a calendar read, as a `CalendarError`; an unknown one is rethrown. */
export function toCalendarError(error: unknown): CalendarError {
  if (error instanceof CalendarError) return error;
  if (error instanceof BoundedFetchError) return calendarErrorOfFetch(error);
  if (error instanceof EgressBlockedError)
    return new CalendarError(
      "notConfigured",
      error.block === "internet_off"
        ? "CALENDAR_EGRESS_INTERNET_OFF"
        : "CALENDAR_EGRESS_SERVICE_OFF"
    );
  throw error;
}

/** An HTTP status of a calendar server, as a failure; null for a success. */
export function calendarErrorOfStatus(status: number): CalendarError | null {
  if (status >= 200 && status < 300) return null;
  if (status >= 300 && status < 400) return new CalendarError("protocol", "CALENDAR_REDIRECT");
  if (status === 401 || status === 403) return new CalendarError("auth");
  if (status === 404 || status === 410) return new CalendarError("notFound");
  if (status >= 500) return new CalendarError("unreachable");
  return new CalendarError("protocol");
}
