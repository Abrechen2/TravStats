import type { Flight } from "../../prisma";
import {
  getAirportTimezone,
  normalizeFlightTimeUtc,
  type FlightTimeSemantics,
} from "../../utils/timezone";

/**
 * How far a phone's observation may lie from the flight's schedule and still
 * be about THIS flight. The live-check rotation guard uses the same 12 hours
 * (`ROTATION_MISMATCH_MAX_HOURS` in flightAutoUpdate.ts): a delay is minutes to
 * a few hours, the wrong day's aircraft — or a recording filed under the wrong
 * flight by the phone — is a day or more away.
 */
export const DEVICE_OBSERVATION_WINDOW_HOURS = 12;
const WINDOW_MS = DEVICE_OBSERVATION_WINDOW_HOURS * 3_600_000;

export type FlightWindowColumns = Pick<
  Flight,
  | "departureTime"
  | "arrivalTime"
  | "depTimeSemantics"
  | "arrTimeSemantics"
  | "depIata"
  | "depIcao"
  | "arrIata"
  | "arrIcao"
>;

/**
 * The flight's scheduled departure and arrival as real instants. A legacy row
 * stores the airport's wall clock as fake UTC; read raw, that is hours off,
 * which is exactly the size of mistake the window exists to catch.
 */
export async function scheduledInstants(
  flight: FlightWindowColumns
): Promise<{ departure: Date | null; arrival: Date | null }> {
  const [depTz, arrTz] = await Promise.all([
    getAirportTimezone(flight.depIata ?? flight.depIcao),
    getAirportTimezone(flight.arrIata ?? flight.arrIcao),
  ]);
  return {
    departure: normalizeFlightTimeUtc(
      flight.departureTime,
      flight.depTimeSemantics as FlightTimeSemantics,
      depTz
    ),
    arrival: normalizeFlightTimeUtc(
      flight.arrivalTime,
      flight.arrTimeSemantics as FlightTimeSemantics,
      arrTz
    ),
  };
}

/** Whether `at` lies within the window around `scheduled`; no schedule decides nothing. */
export function nearSchedule(at: Date, scheduled: Date | null): boolean {
  if (!scheduled) return true;
  return Math.abs(at.getTime() - scheduled.getTime()) <= WINDOW_MS;
}

/**
 * Whether a recording spanning `[startMs, endMs]` touches the flight's
 * scheduled span widened by the window on both sides. A flight with no
 * schedule at all (a historical entry) accepts any recording.
 */
export function overlapsSchedule(
  startMs: number,
  endMs: number,
  scheduled: { departure: Date | null; arrival: Date | null }
): boolean {
  const from = scheduled.departure ?? scheduled.arrival;
  const to = scheduled.arrival ?? scheduled.departure;
  if (!from || !to) return true;
  return endMs >= from.getTime() - WINDOW_MS && startMs <= to.getTime() + WINDOW_MS;
}

/**
 * How long before the scheduled departure and after the scheduled arrival the
 * Companion's flight recorder is armed (companion `adrs/0010`): 30 minutes on
 * either side. Inside that window the flight recording owns the phone's fixes,
 * so a trip recording leaves them out instead of storing them twice.
 */
export const RECORDER_ARM_MARGIN_MS = 30 * 60_000;

/**
 * The flight recorder's armed window as `[fromMs, toMs]`, or null for a
 * flight with no schedule at all — no window can be stated for it, and a
 * guessed one would drop a trip's fixes for nothing.
 */
export function recorderWindow(scheduled: {
  departure: Date | null;
  arrival: Date | null;
}): [number, number] | null {
  const from = scheduled.departure ?? scheduled.arrival;
  const to = scheduled.arrival ?? scheduled.departure;
  if (!from || !to) return null;
  return [from.getTime() - RECORDER_ARM_MARGIN_MS, to.getTime() + RECORDER_ARM_MARGIN_MS];
}
