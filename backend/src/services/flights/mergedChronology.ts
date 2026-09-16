import { fromZonedTime } from "date-fns-tz";

import { AppError } from "../../middleware/errorHandler";

/**
 * An UPDATE has to be judged on what it leaves behind, not on what it sent.
 *
 * The Zod schema sees only the body, so a PUT carrying just a departure had
 * nothing to compare it with: moving the departure a day later answered 200 and
 * left the arrival sitting in the past (audit finding AUD-018). The merged end
 * state is checked here, against the real instants the row actually stores —
 * the wall-clock strings that reach the schema belong to two different clocks
 * and cannot be ordered against each other at all.
 *
 * Lives in its own module because `routes/flights.ts` is over the 800-line
 * limit and frozen at its size.
 */

export interface ChronologyPatch {
  departureLocal?: string | null;
  arrivalLocal?: string | null;
  depTimezone?: string | null;
  arrTimezone?: string | null;
  depTimeSemantics?: string | null;
  arrTimeSemantics?: string | null;
}

export interface StoredFlightTimes {
  departureTime: Date | null;
  arrivalTime: Date | null;
  depTimeSemantics: string;
  arrTimeSemantics: string;
}

/**
 * A paired (local wall-clock + IANA zone) input as a real UTC instant.
 * Null when either side is missing — the schema's `requirePairedTimezone`
 * already enforces that a present local string carries a zone.
 */
export function toUtcDate(local: string | null | undefined, tz: string | null | undefined): Date | null {
  if (!local || !tz) return null;
  const instant = fromZonedTime(local, tz);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Throw when the update's RESULT would arrive before it departs.
 *
 * `undefined` means the field was not sent and the stored instant stands;
 * anything sent is converted with the zone that came beside it. A row whose
 * stored semantics are not a canonical UTC instant is left alone — its
 * `departureTime` is a placeholder or an unclassified legacy value, and
 * ordering those would refuse edits to exactly the rows that most need them.
 */
export function assertMergedChronology(
  data: ChronologyPatch,
  existing: StoredFlightTimes,
): void {
  const depSemantics = data.depTimeSemantics ?? existing.depTimeSemantics;
  const arrSemantics = data.arrTimeSemantics ?? existing.arrTimeSemantics;
  if (depSemantics !== "UTC" || arrSemantics !== "UTC") return;

  const departure =
    data.departureLocal !== undefined
      ? toUtcDate(data.departureLocal, data.depTimezone)
      : existing.departureTime;
  const arrival =
    data.arrivalLocal !== undefined
      ? toUtcDate(data.arrivalLocal, data.arrTimezone)
      : existing.arrivalTime;

  if (departure && arrival && arrival.getTime() < departure.getTime()) {
    throw new AppError("the flight cannot arrive before it departs", 400);
  }
}
