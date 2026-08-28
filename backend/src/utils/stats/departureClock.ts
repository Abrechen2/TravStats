import { localWallClockOf, type LocalWallClock } from '../timezone';
import type { FlightData } from './types';

/**
 * The clock at the departure airport when this flight left, or null when the
 * flight carries no departure time at all.
 *
 * Single point where the stats modules read a departure's wall clock, so the
 * timezone and the storage semantics travel together and no figure can end up
 * silently reading the raw UTC instant instead (#266).
 */
export function departureClockOf(flight: FlightData): LocalWallClock | null {
  if (!flight.departureTime) return null;
  return localWallClockOf(flight.departureTime, flight.depTimezone, flight.depTimeSemantics);
}
