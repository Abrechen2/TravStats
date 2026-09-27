import { legacyDayOf } from "../../shared/time/legacyValues";
import { fromDbDate } from "../../shared/time/localDate";
import { serializeDay, serializeTime, type LocalDateValue } from "../../shared/time/wire";
import type { StayTimes } from "../../schemas/times";

/**
 * A stay's `times` (ADR 0002 phase 4): the check-in/-out DAYS as the hotel
 * knew them, and — where the stay has a time and the hotel a zone — the
 * instants they begin and end.
 *
 * The days are read from the `DATE` columns (`check_in_date`, …) and go out as
 * `YYYY-MM-DD`, never as a UTC midnight a client could shift by its own zone.
 * A stay the backfill has not reached yet still has only its legacy anchor;
 * that anchor is read by the backfill's own rule (`legacyDayOf`), and an
 * anchor that rule cannot place without guessing goes out as `unknown`.
 */
export interface StayTimeColumns {
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDate: Date | null;
  checkOutDate: Date | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  stayZone: string | null;
  datePrecision: string;
}

type DayPrecision = LocalDateValue["precision"];

/** `LodgingStay.date_precision` (DAY | MONTH | YEAR | NONE) in the wire's words; null = no date at all. */
function precisionOf(datePrecision: string): DayPrecision | null {
  switch (datePrecision) {
    case "MONTH":
      return "month";
    case "YEAR":
      return "year";
    case "NONE":
      return null;
    default:
      return "day";
  }
}

function stayDay(
  day: Date | null,
  legacy: Date | null,
  zone: string | null,
  precision: DayPrecision | null
): LocalDateValue | null {
  if (precision === null) return null;
  if (day) return serializeDay(fromDbDate(day), zone, precision);
  if (!legacy) return null;
  const reading = legacyDayOf(legacy);
  return serializeDay(reading.day, zone, reading.ambiguous ? "unknown" : precision);
}

export function stayTimes(s: StayTimeColumns): StayTimes {
  const precision = precisionOf(s.datePrecision);
  return {
    checkIn: stayDay(s.checkInDate, s.checkIn, s.stayZone, precision),
    checkOut: stayDay(s.checkOutDate, s.checkOut, s.stayZone, precision),
    // Filled only with a zone (stayColumns.ts); the guard keeps a bad row honest.
    checkInAt: s.checkInAt && s.stayZone ? serializeTime(s.checkInAt, s.stayZone) : null,
    checkOutAt: s.checkOutAt && s.stayZone ? serializeTime(s.checkOutAt, s.stayZone) : null,
  };
}

export function withStayTimes<T extends StayTimeColumns>(s: T): T & { times: StayTimes } {
  return { ...s, times: stayTimes(s) };
}

/** A lodging with each of its stays carrying `times`. */
export function withLodgingStayTimes<S extends StayTimeColumns, T extends { stays: S[] }>(
  lodging: T
): T & { stays: Array<S & { times: StayTimes }> } {
  return { ...lodging, stays: lodging.stays.map(withStayTimes) };
}
