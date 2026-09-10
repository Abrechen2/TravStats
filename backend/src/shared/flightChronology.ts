import { fromZonedTime } from "date-fns-tz";

/**
 * Does this flight arrive after it departs?
 *
 * The answer used to be a string comparison of two wall-clock times read off
 * two different clocks. That is not a comparison of moments, and it was wrong
 * in both directions (audit finding AUD-018):
 *
 *  - A perfectly ordinary westward flight was REFUSED. Central Europe 10:00 to
 *    London 09:45 is forty-five minutes in the air; the strings say the
 *    arrival is earlier. Tokyo 20:00 to Honolulu 08:00 is seven hours and
 *    crosses the date line backwards; the strings say the arrival is the
 *    previous day.
 *  - A flight that goes backwards in time was ACCEPTED. London 10:00 to
 *    Berlin 10:30 stored 10:00Z and 09:30Z — an arrival thirty minutes before
 *    the departure, sitting in the database as a valid row.
 *
 * The timezones needed to answer it properly were already on the payload:
 * `requirePairedTimezone` has always demanded a zone beside every local time.
 * Nothing asked them.
 *
 * **DATE_ONLY stays a date comparison, deliberately.** Those rows carry a
 * 12:00 placeholder that the server may shift by hours during airport-timezone
 * conversion, so their clock time means nothing and only the day can be
 * compared — and a same-day round trip must not be refused because a shift
 * pushed the placeholder arrival before the placeholder departure.
 *
 * Backend-only for now: the frontend does not validate chronology, so a mirror
 * would be a copy with no second reader. `date-fns-tz` is present on both
 * sides if that changes.
 */

export interface ChronologyInput {
  departureLocal?: string | null;
  arrivalLocal?: string | null;
  depTimezone?: string | null;
  arrTimezone?: string | null;
  depTimeSemantics?: string | null;
  arrTimeSemantics?: string | null;
}

export interface ChronologyProblem {
  /** Which field the message belongs beside. */
  path: "arrivalLocal";
  message: string;
}

/**
 * Whether only the DAY of these two stamps is meaningful.
 *
 * The explicit semantics field is the real answer; the twin-12:00 test is the
 * older signal kept for rows and clients that never set one.
 */
function isDateOnly(data: ChronologyInput): boolean {
  return (
    data.depTimeSemantics === "DATE_ONLY" ||
    data.arrTimeSemantics === "DATE_ONLY" ||
    Boolean(
      data.departureLocal?.endsWith("T12:00") && data.arrivalLocal?.endsWith("T12:00"),
    )
  );
}

/** A wall-clock string plus its zone as a real instant, or null when either is absent. */
function toInstant(local: string | null | undefined, tz: string | null | undefined): Date | null {
  if (!local || !tz) return null;
  const instant = fromZonedTime(local, tz);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * The problem with this pair, or `null` when there is none.
 *
 * Takes the MERGED view of a flight, never a partial body: a PUT that moves
 * only the departure has to be checked against the arrival that stays behind,
 * which is the second half of the same finding — sending just a departure a
 * day later used to answer 200 and leave the arrival in the past.
 */
export function chronologyProblem(data: ChronologyInput): ChronologyProblem | null {
  if (!data.departureLocal || !data.arrivalLocal) return null;

  if (isDateOnly(data)) {
    return data.departureLocal.slice(0, 10) > data.arrivalLocal.slice(0, 10)
      ? { path: "arrivalLocal", message: "arrival date must not precede departure date" }
      : null;
  }

  const departure = toInstant(data.departureLocal, data.depTimezone);
  const arrival = toInstant(data.arrivalLocal, data.arrTimezone);

  if (departure && arrival) {
    return arrival.getTime() < departure.getTime()
      ? { path: "arrivalLocal", message: "the flight cannot arrive before it departs" }
      : null;
  }

  // No zone to convert with. `requirePairedTimezone` makes this unreachable
  // for a well-formed payload, so this is the older, weaker comparison kept as
  // a floor rather than a silent pass — a row with no zone at all should still
  // not claim to arrive a day before it left.
  return data.departureLocal.slice(0, 10) > data.arrivalLocal.slice(0, 10)
    ? { path: "arrivalLocal", message: "arrival date must not precede departure date" }
    : null;
}

/**
 * Whether a flight marked as already taken claims a departure in the future.
 *
 * Same defect, smaller blast radius: the check compared a wall-clock string
 * against `new Date().toISOString()`, so a flight that had just left Tokyo
 * read as thirteen hours in the future and was refused as `flown`.
 */
export function departsInFuture(
  departureLocal: string | null | undefined,
  depTimezone: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!departureLocal) return false;
  const instant = toInstant(departureLocal, depTimezone);
  if (instant) return instant.getTime() > now.getTime();
  // Without a zone, the old lexicographic comparison is the best available.
  return departureLocal > now.toISOString().slice(0, 19);
}
