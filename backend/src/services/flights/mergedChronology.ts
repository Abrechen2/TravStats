import { AppError } from "../../middleware/errorHandler";
import { toInstant, type Fold } from "../../shared/time/instant";

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
  departureFold?: Fold | null;
  arrivalFold?: Fold | null;
}

export interface StoredFlightTimes {
  departureTime: Date | null;
  arrivalTime: Date | null;
  depTimeSemantics: string;
  arrTimeSemantics: string;
}

/**
 * A paired (local wall-clock + IANA zone) input as a real UTC instant,
 * through `shared/time` (ADR 0002). Null when either side is missing — the
 * schema's `requirePairedTimezone` already enforces that a present local
 * string carries a zone. A repeated autumn hour is the earlier occurrence
 * unless `fold` says later (owner decision Q5); `fromZonedTime` picked one
 * without saying which. A typed hour the zone skipped throws
 * LOCAL_TIME_NONEXISTENT — the schema already refuses it, this is the guard.
 */
export function toUtcDate(
  local: string | null | undefined,
  tz: string | null | undefined,
  fold?: Fold | null
): Date | null {
  if (!local || !tz) return null;
  return toInstant(local, tz, { fold: fold ?? undefined, origin: "typed" }).utc;
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
export function assertMergedChronology(data: ChronologyPatch, existing: StoredFlightTimes): void {
  const depSemantics = data.depTimeSemantics ?? existing.depTimeSemantics;
  const arrSemantics = data.arrTimeSemantics ?? existing.arrTimeSemantics;
  if (depSemantics !== "UTC" || arrSemantics !== "UTC") return;

  const departure =
    data.departureLocal !== undefined
      ? toUtcDate(data.departureLocal, data.depTimezone, data.departureFold)
      : existing.departureTime;
  const arrival =
    data.arrivalLocal !== undefined
      ? toUtcDate(data.arrivalLocal, data.arrTimezone, data.arrivalFold)
      : existing.arrivalTime;

  if (departure && arrival && arrival.getTime() < departure.getTime()) {
    throw new AppError("the flight cannot arrive before it departs", 400);
  }
}
