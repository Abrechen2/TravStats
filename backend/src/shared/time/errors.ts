import { AppError } from "../../middleware/errorHandler";

/**
 * The refusals of the time model (ADR 0002 D2/D3). Each carries a stable
 * code, because a client that has to tell "you typed an hour that does not
 * exist" from "this place has no zone" cannot do it from English prose.
 *
 * Two of them are easy to confuse and must stay apart:
 * - `TZ_UNRESOLVED` (422): the lookup ran and this place HAS no zone — no
 *   catalogue zone, no usable coordinates. The request is what is missing.
 * - `TIMEZONE_LOOKUP_UNAVAILABLE` (503): the lookup could not run at all.
 *   The request was fine; the server is not.
 */

/** A wall clock typed by a person that the zone skips (spring-forward gap). */
export class LocalTimeNonexistentError extends AppError {
  constructor(local: string, zone: string) {
    super(`${local} does not exist in ${zone}`, 422, "LOCAL_TIME_NONEXISTENT");
    this.name = "LocalTimeNonexistentError";
  }
}

/** A zone name this runtime's tzdata does not know. */
export class ZoneUnknownError extends AppError {
  constructor(zone: string) {
    super(`Unknown time zone: ${zone}`, 422, "ZONE_UNKNOWN");
    this.name = "ZoneUnknownError";
  }
}

/** The place has no zone the resolver can name. */
export class TzUnresolvedError extends AppError {
  constructor(reason: string) {
    super(`This place has no time zone: ${reason}`, 422, "TZ_UNRESOLVED");
    this.name = "TzUnresolvedError";
  }
}

/** The zone lookup itself is broken — never read as "no zone". */
export class ZoneLookupUnavailableError extends AppError {
  constructor(cause: unknown) {
    super(
      `Time zone lookup unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      503,
      "TIMEZONE_LOOKUP_UNAVAILABLE"
    );
    this.name = "ZoneLookupUnavailableError";
  }
}

/** A local reading or calendar date that is not well formed (`2027-02-30`, `25:00`). */
export class InvalidLocalTimeError extends AppError {
  constructor(value: string) {
    super(`Not a valid local date or time: ${value}`, 422, "VALIDATION_FAILED");
    this.name = "InvalidLocalTimeError";
  }
}
