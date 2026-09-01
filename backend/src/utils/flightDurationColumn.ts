/**
 * How to READ `flights.duration_minutes` (forgejo#45).
 *
 * The column is a Postgres STORED generated column — see the block comment on
 * `durationMinutes` in `schema.prisma` and the migration
 * `20260901103000_flight_duration_minutes` for why the database owns it rather
 * than any write path. This file is the other half of that bargain: the column
 * answers for most rows, and this decides which.
 *
 * `tzAwareDurationMinutes` reads the airport catalogue in exactly ONE case —
 * both endpoints tagged `LEGACY_FAKE_UTC`, where the stored components are
 * wall-clock and only become instants through their airports' timezones. For
 * every other tagging the timezone is never consulted and the duration is a
 * pure function of the flight row, which is precisely the set the database can
 * keep true on its own.
 *
 * So the rule is: trust the column unless the row is catalogue-dependent, and
 * derive as before when it is. A timezone correction on an airport therefore
 * takes effect on the very next read for the rows it can affect, and cannot
 * silently invalidate a stored number for the rows it cannot.
 *
 * The result is the MEASURED duration, or null when there is none. It is the
 * `measuredMinutes` input to `resolveFlightDuration`, never a substitute for
 * it — null must keep meaning "no duration" and reach the estimate, not 0.
 */

import { tzAwareDurationMinutes, type FlightTimeSemantics } from './timezone';

/** The columns a caller must select for the answer to be trustworthy. */
export interface FlightDurationRow {
  departureTime: Date | null;
  arrivalTime: Date | null;
  depTimeSemantics: string;
  arrTimeSemantics: string;
  /** The stored generated column. Null also means "ask the catalogue" — see below. */
  durationMinutes: number | null;
}

/**
 * True when the row's duration depends on data OUTSIDE the row, so the stored
 * column is null by construction and the answer has to be derived.
 *
 * Nothing writes `LEGACY_FAKE_UTC` any more (every create path defaults to
 * `'UTC'`); the tag exists only on rows the backfill classified, and
 * `scripts/fixMistaggedDurations.ts` converts them away. This predicate is
 * therefore expected to answer false more often over time, not less.
 */
export function isCatalogueDerivedDuration(
  depTimeSemantics: string,
  arrTimeSemantics: string,
): boolean {
  return depTimeSemantics === 'LEGACY_FAKE_UTC' && arrTimeSemantics === 'LEGACY_FAKE_UTC';
}

/**
 * The measured duration in minutes, or null when the row carries none.
 *
 * Equivalent by construction to what every consumer computed inline before
 * this column existed — same guards, same fallbacks, same fractional minutes —
 * so no figure on any screen moves. The timezones are still required because
 * legacy rows still need them; they are simply no longer consulted for the
 * rows that do not.
 */
export function measuredDurationMinutes(
  flight: FlightDurationRow,
  depTz: string | null,
  arrTz: string | null,
): number | null {
  if (!isCatalogueDerivedDuration(flight.depTimeSemantics, flight.arrTimeSemantics)) {
    return flight.durationMinutes;
  }
  if (!flight.departureTime || !flight.arrivalTime) return null;
  return tzAwareDurationMinutes(
    flight.departureTime,
    flight.arrivalTime,
    depTz,
    arrTz,
    flight.depTimeSemantics as FlightTimeSemantics,
    flight.arrTimeSemantics as FlightTimeSemantics,
  );
}

/** What the API puts on the wire: whole minutes, or null. */
export function roundedMeasuredDurationMinutes(
  flight: FlightDurationRow,
  depTz: string | null,
  arrTz: string | null,
): number | null {
  const minutes = measuredDurationMinutes(flight, depTz, arrTz);
  return minutes === null ? null : Math.round(minutes);
}
