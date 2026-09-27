/**
 * "Die spätere meinen" for a flight's repeated hour (ADR 0002, D3 / owner
 * decision Q5).
 *
 * When a clock goes back, 02:30 happens twice at the airport. The server takes
 * the EARLIER occurrence unless the client sends `departureFold` /
 * `arrivalFold: "later"`; until now the flight forms could not, so a flight
 * really leaving in the second 02:30 was stored an hour early with no way to
 * say otherwise. The forms now show `ClockChangeNotice` beside each time, as
 * the cruise stop editor does, and these helpers carry the choice.
 *
 * A fold is sent only while the typed time IS repeated at that airport: a
 * choice made for 02:30 must not ride along after the time was changed to
 * 09:00, where it would mean nothing — or, worse, something next autumn.
 */
import { classifyWallClock, storedFold, type TimeValue } from "../shared/time";

/** The later occurrence per end; absent means the earlier (the server's default). */
export interface FlightFolds {
  dep?: "later";
  arr?: "later";
}

/** What the flight write body carries for the folds (`schemas/flight.ts`). */
export interface FlightFoldFields {
  departureFold?: "later";
  arrivalFold?: "later";
}

interface End {
  /** `YYYY-MM-DDTHH:mm` as sent, or undefined when no time is sent. */
  local: string | null | undefined;
  zone: string | null | undefined;
}

/** One end of a form: its date and time inputs and the airport's zone. */
export function wallOf(date: string, time: string, zone: string | null | undefined): End {
  return { local: date && time ? `${date}T${time}` : null, zone };
}

const repeated = (end: End): boolean =>
  Boolean(end.local && end.zone && classifyWallClock(end.local, end.zone) === "repeated");

/** The fold fields for a write body — only where the sent time is repeated. */
export function foldFields(folds: FlightFolds, dep: End, arr: End): FlightFoldFields {
  return {
    ...(folds.dep === "later" && repeated(dep) ? { departureFold: "later" as const } : {}),
    ...(folds.arr === "later" && repeated(arr) ? { arrivalFold: "later" as const } : {}),
  };
}

function storedEnd(value: TimeValue | null): "later" | undefined {
  if (!value?.zone) return undefined;
  return storedFold(value.local.slice(0, 16), value.zone, value.utc);
}

/**
 * The folds a stored flight already has, so an edit that does not touch the
 * time re-sends the occurrence that was stored instead of silently falling
 * back to the earlier one.
 */
export function storedFlightFolds(dep: TimeValue | null, arr: TimeValue | null): FlightFolds {
  const d = storedEnd(dep);
  const a = storedEnd(arr);
  return { ...(d ? { dep: d } : {}), ...(a ? { arr: a } : {}) };
}
