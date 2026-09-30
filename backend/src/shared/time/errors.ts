import type { ZodError } from "zod";
import { AppError, zodTimeIssue } from "../../middleware/errorHandler";

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
  constructor(local: string, zone: string, field?: string) {
    super(`${local} does not exist in ${zone}`, 422, "LOCAL_TIME_NONEXISTENT", field);
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
  constructor(reason: string, field?: string) {
    super(`This place has no time zone: ${reason}`, 422, "TZ_UNRESOLVED", field);
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

/**
 * A time sent in a shape the server may not interpret (ADR 0002 D3, phase 2):
 * an offset-less datetime string, which the host would read in its own zone,
 * or — from a browser session — a bare ISO-Z on a field that used to store
 * the place's wall clock as fake UTC. The second is what a web bundle cached
 * from before the deploy sends; read as an instant it would move every visit
 * by the place's offset, so it is refused and the page is told to reload.
 */
export class TimeShapeRequiredError extends AppError {
  constructor(field?: string) {
    super(
      "Send a time as {local, zone} or {local, placeRef}, a day as YYYY-MM-DD",
      422,
      "TIME_SHAPE_REQUIRED",
      field
    );
    this.name = "TimeShapeRequiredError";
  }
}

/**
 * The 422 a ZodError stands for when one of its issues is a time-model
 * refusal, or null. Routes that turn a failed `safeParse` into their own 400
 * ask this first, so a client gets `TIME_SHAPE_REQUIRED` / `ZONE_UNKNOWN` and
 * the field instead of zod's prose.
 */
export function timeErrorFromZod(error: ZodError): AppError | null {
  const found = zodTimeIssue(error);
  if (!found) return null;
  return new AppError(`Time field refused: ${found.code}`, 422, found.code, found.field);
}
