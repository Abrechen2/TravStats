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
