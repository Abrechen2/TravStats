/**
 * Time zones crossed by air: hours shifted in total, the biggest single jump
 * and an estimate of jet-lag days (forgejo#399).
 *
 * A flight's shift is the UTC offset of the ARRIVAL zone at the arrival
 * instant minus the offset of the DEPARTURE zone at the departure instant,
 * so a daylight-saving change on the day counts as the hour it really was.
 * Hours shifted are the sum of the ABSOLUTE shifts — flying 6 h east and 6 h
 * back is 12 hours shifted, which is what the body went through.
 *
 * Which flights can be measured. Only a flight with both instants real (a
 * `UTC` time semantics — a date-only or legacy placeholder carries no
 * trustworthy hour) and both zones known. The others are counted in
 * `unmeasured` and contribute nothing; with none measurable every figure is
 * `null` rather than zero.
 *
 * `jetLagDays` is an ESTIMATE under a published rule: a shift of at least
 * `JET_LAG_MIN_HOURS` costs one day of adjustment per started hour shifted
 * eastward and half that westward (the usual rule of thumb: the body
 * adjusts more slowly going east), summed per flight without merging
 * overlapping recoveries. The response carries the rule's thresholds so a
 * client can say what it assumed.
 */
import { offsetMsAt } from "../../../shared/time/zonedParts";

export const JET_LAG_MIN_HOURS = 3;

export interface TimeShiftFlight {
  id: string;
  departureTime: Date | null;
  arrivalTime: Date | null;
  depZone: string | null;
  arrZone: string | null;
  /** Both ends carry a real instant (`UTC` semantics). */
  instantsReal: boolean;
  depLabel: string | null;
  arrLabel: string | null;
}

export interface BiggestJump {
  flightId: string;
  /** Signed: positive is eastward. */
  hours: number;
  from: string | null;
  to: string | null;
  date: string;
}

export interface TimeShiftStats {
  flightsMeasured: number;
  /** Flights that could not be measured (date-only, no zone) — left out, never zero-filled. */
  unmeasured: number;
  hoursShifted: number;
  biggestJump: BiggestJump | null;
  jetLagDays: number;
  jetLagRule: { minHours: number; eastPerHour: number; westPerHour: number };
}

export function shiftHours(flight: TimeShiftFlight): number | null {
  if (!flight.instantsReal || !flight.departureTime || !flight.arrivalTime) return null;
  if (!flight.depZone || !flight.arrZone) return null;
  const dep = offsetMsAt(flight.departureTime.getTime(), flight.depZone);
  const arr = offsetMsAt(flight.arrivalTime.getTime(), flight.arrZone);
  if (dep === null || arr === null) return null;
  return foldToHalfDay(Math.round(((arr - dep) / 3_600_000) * 100) / 100);
}

/**
 * The body adjusts the SHORT way round: Tokyo to Honolulu is 5 hours east
 * (the date line), not 19 hours west. Folds a raw offset difference into
 * (-12, 12]; exactly 12 is read eastward.
 */
export function foldToHalfDay(hours: number): number {
  const folded = ((((hours + 12) % 24) + 24) % 24) - 12;
  return folded === -12 ? 12 : folded;
}

export function computeTimeShift(flights: readonly TimeShiftFlight[]): TimeShiftStats | null {
  let measured = 0;
  let hours = 0;
  let lag = 0;
  let biggest: BiggestJump | null = null;
  for (const flight of flights) {
    const h = shiftHours(flight);
    if (h === null) continue;
    measured += 1;
    const abs = Math.abs(h);
    hours += abs;
    if (abs >= JET_LAG_MIN_HOURS) lag += h > 0 ? Math.ceil(abs) : Math.ceil(abs) / 2;
    if (abs > 0 && (biggest === null || abs > Math.abs(biggest.hours))) {
      biggest = {
        flightId: flight.id,
        hours: h,
        from: flight.depLabel,
        to: flight.arrLabel,
        date: flight.departureTime!.toISOString().slice(0, 10),
      };
    }
  }
  if (measured === 0) return null;
  return {
    flightsMeasured: measured,
    unmeasured: flights.length - measured,
    hoursShifted: Math.round(hours * 100) / 100,
    biggestJump: biggest,
    jetLagDays: lag,
    jetLagRule: { minHours: JET_LAG_MIN_HOURS, eastPerHour: 1, westPerHour: 0.5 },
  };
}
