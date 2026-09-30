import type { LocalDateValue, TimeValue } from "../shared/time";

/**
 * The `times` object each entity carries since phase 4 of the time model
 * (ADR 0002, D3 "out"): every time field as `{ utc, zone, offset, local,
 * precision }` (an instant at a place) or `{ date, zone, precision }` (a day).
 *
 * Additive: the old fields stay beside it until the Companion has moved
 * (phase 6), and a payload without `times` is read through
 * `lib/entityTimes.ts`, which falls back to the old fields. Every key is
 * optional for that reason — a component never reads these directly.
 */

export interface FlightTimes {
  departure?: TimeValue | null;
  arrival?: TimeValue | null;
  actualDeparture?: TimeValue | null;
  actualArrival?: TimeValue | null;
}

export interface RailTimes {
  departure?: TimeValue | null;
  arrival?: TimeValue | null;
  actualDeparture?: TimeValue | null;
  actualArrival?: TimeValue | null;
}

export interface StayTimes {
  checkIn?: LocalDateValue | null;
  checkOut?: LocalDateValue | null;
  checkInAt?: TimeValue | null;
  checkOutAt?: TimeValue | null;
}

export interface VisitTimes {
  visitedAt?: TimeValue | null;
}

export interface CruiseTimes {
  start?: LocalDateValue | null;
  end?: LocalDateValue | null;
}

export interface CruiseStopTimes {
  date?: LocalDateValue | null;
  arrival?: TimeValue | null;
  departure?: TimeValue | null;
}

export interface TripTimes {
  start?: LocalDateValue | null;
  end?: LocalDateValue | null;
}

export interface TripStopTimes {
  start?: TimeValue | null;
  end?: TimeValue | null;
}

export interface JournalTimes {
  day?: LocalDateValue | null;
}
