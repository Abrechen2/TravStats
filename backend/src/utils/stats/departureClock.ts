import { localWallClockOf, type LocalWallClock, type FlightTimeSemantics } from "../timezone";

/**
 * The clock at the departure airport when this flight left, or null when the
 * flight carries no departure time at all.
 *
 * Single point where the stats modules read a departure's wall clock, so the
 * timezone and the storage semantics travel together and no figure can end up
 * silently reading the raw UTC instant instead (#266).
 *
 * Typed on the three fields it reads rather than on `FlightData`: the evidence
 * resolvers (`services/evidence/metricEvidenceFlight*.ts`) hand it a narrow
 * Prisma projection carrying exactly these columns, and a `FlightData`
 * parameter would have made them widen the projection — loading coordinates
 * and prices to read an hour — or cast. `FlightData` still satisfies it.
 */
export interface DepartureClockRow {
  departureTime: Date | null;
  depTimezone?: string | null;
  depTimeSemantics?: FlightTimeSemantics;
}

export function departureClockOf(flight: DepartureClockRow): LocalWallClock | null {
  if (!flight.departureTime) return null;
  return localWallClockOf(flight.departureTime, flight.depTimezone, flight.depTimeSemantics);
}

/**
 * The calendar day a flight left on - the record / sequence-badge reading of
 * the departure clock.
 *
 * A DATE_ONLY row stores 12:00Z of the day the user recorded; that date IS the
 * answer, so the zone is deliberately not applied. Read through a zone east of
 * UTC+12 (Auckland in summer, Suva, Kiritimati) the placeholder instant is
 * already the next local day and the flight would silently move a day.
 * Everything else is read on the departure airport's clock; a row with no
 * usable zone is read on its stored components.
 */
export function departureDayOf(flight: DepartureClockRow): string | null {
  const dateOnly = flight.depTimeSemantics === "DATE_ONLY";
  return (
    departureClockOf({ ...flight, depTimezone: dateOnly ? null : flight.depTimezone })?.date ?? null
  );
}
