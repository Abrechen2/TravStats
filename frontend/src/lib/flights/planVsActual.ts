import {
  flightActualArrival,
  flightActualDeparture,
  flightArrival,
  flightDeparture,
} from "../entityTimes";
import { daysBetween, type TimeValue } from "../../shared/time";
import type { Flight } from "../../types";

/**
 * Plan against what happened, for each end of a flight (forgejo#216) — ONE
 * home for the comparison, so the detail page cannot grow a second idea of
 * what "late" means.
 *
 * Abstention is a result:
 * - A deviation is measured only between two instants known to the minute,
 *   on `TimeValue.utc` — so a flight across zones, or inside the repeated
 *   autumn hour, measures what really passed. A plan known only by its day,
 *   or no recorded actual time, is `unknown` with its reason, never 0.
 * - A day change is read off the PLACE's calendar (`TimeValue.local`), which
 *   is what "arrives the next day" means to the traveller. It needs both ends
 *   known at least to the day; otherwise it is `null`.
 *
 * Where the actual times come from: `actualDeparture` / `actualArrival`, which
 * the user types, a live-data provider reports, or the Companion's observed
 * takeoff and landing fill once applied (`routes/flights/observedTimes.ts`
 * routes them through the pending-update review). Nothing here invents one.
 */

export type DeviationUnknownReason =
  /** No actual time was recorded for this end. */
  | "noActual"
  /** No planned time at all. */
  | "noPlan"
  /** The plan is known only by its day (or less), so minutes cannot be counted. */
  | "planNotToMinute"
  /** The recorded actual time is not known to the minute. */
  | "actualNotToMinute";

export type Deviation =
  /** `minutes` is actual minus planned: positive = later, negative = earlier, 0 = as planned. */
  { kind: "minutes"; minutes: number } | { kind: "unknown"; reason: DeviationUnknownReason };

export interface EndComparison {
  planned: TimeValue | null;
  actual: TimeValue | null;
  deviation: Deviation;
  /**
   * Calendar days from the planned local day to the actual local day at this
   * airport (1 = a day later than planned). Null when either day is unknown.
   */
  actualDayShift: number | null;
}

export interface FlightPlanActual {
  departure: EndComparison;
  arrival: EndComparison;
  /**
   * Local calendar days from the planned departure to the planned arrival —
   * 1 for an overnight flight, −1 across the date line westwards. Null when
   * either planned day is unknown.
   */
  plannedArrivalDayOffset: number | null;
  /**
   * The same for the recorded times. Only when BOTH actual ends are recorded:
   * read against the planned departure instead, a departure delayed past
   * midnight would turn "the next day" into a claim nobody measured.
   */
  actualArrivalDayOffset: number | null;
}

const knowsMinute = (value: TimeValue): boolean => value.precision === "minute";
const knowsDay = (value: TimeValue): boolean =>
  value.precision === "minute" || value.precision === "day";

/** The place's own calendar day, or null when the value does not know it. */
function localDayOf(value: TimeValue | null): string | null {
  return value && knowsDay(value) ? value.local.slice(0, 10) : null;
}

function dayOffset(from: TimeValue | null, to: TimeValue | null): number | null {
  const a = localDayOf(from);
  const b = localDayOf(to);
  return a === null || b === null ? null : daysBetween(a, b);
}

/** Signed minutes from `planned` to `actual`, on instants, or the reason there are none. */
export function deviationOf(planned: TimeValue | null, actual: TimeValue | null): Deviation {
  if (!planned) return { kind: "unknown", reason: "noPlan" };
  if (!actual) return { kind: "unknown", reason: "noActual" };
  if (!knowsMinute(planned)) return { kind: "unknown", reason: "planNotToMinute" };
  if (!knowsMinute(actual)) return { kind: "unknown", reason: "actualNotToMinute" };
  const minutes = Math.round((Date.parse(actual.utc) - Date.parse(planned.utc)) / 60_000);
  return Number.isFinite(minutes)
    ? { kind: "minutes", minutes }
    : { kind: "unknown", reason: "noActual" };
}

export function compareEnd(planned: TimeValue | null, actual: TimeValue | null): EndComparison {
  return {
    planned,
    actual,
    deviation: deviationOf(planned, actual),
    actualDayShift: actual ? dayOffset(planned, actual) : null,
  };
}

type FlightTimesInput = Parameters<typeof flightDeparture>[0];

/** Both ends of a flight, plan against record. */
export function flightPlanActual(flight: FlightTimesInput | Flight): FlightPlanActual {
  const plannedDep = flightDeparture(flight);
  const plannedArr = flightArrival(flight);
  const actualDep = flightActualDeparture(flight);
  const actualArr = flightActualArrival(flight);
  return {
    departure: compareEnd(plannedDep, actualDep),
    arrival: compareEnd(plannedArr, actualArr),
    plannedArrivalDayOffset: dayOffset(plannedDep, plannedArr),
    actualArrivalDayOffset: actualDep && actualArr ? dayOffset(actualDep, actualArr) : null,
  };
}
