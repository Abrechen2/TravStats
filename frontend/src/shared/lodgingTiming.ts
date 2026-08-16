/**
 * What a stay's dates are actually good for.
 *
 * A hotel you remember but cannot date is still a place you slept, and rating,
 * price, board, room and membership all live on the STAY — so before the dates
 * became nullable those data points had nowhere to go. Flights
 * (`departureTime` + `depTimeSemantics`) and cruises (`startDate`) had always
 * allowed it; lodging was the odd one out.
 *
 * The danger a nullable date brings is the one `Flight.depTimeSemantics`
 * already guards against: a placeholder that is not marked as one gets
 * aggregated as if it were real. "July 2011" stored as the 1st would land in a
 * weekday histogram as a Friday. So every consumer asks THIS module what it may
 * do with a stay, and nothing reads `checkIn` directly to decide.
 *
 * Owner rule (2026-08-16): an undated stay counts in sums, rankings and
 * achievements — everything that needs no calendar position — and never in a
 * calendar series or in trip gap analysis, because a guessed date there would
 * be indistinguishable from a known one.
 *
 * Frontend MIRROR of `backend/src/shared/lodgingTiming.ts`, same convention as
 * shared/domains.ts and shared/lodgingCounting.ts. Change both together.
 */

/** How much of the date is actually known. */
export type LodgingDatePrecision = "DAY" | "MONTH" | "YEAR" | "NONE";

/** Tuple, not `readonly T[]`, so a Zod enum can consume it directly. */
export const LODGING_DATE_PRECISIONS = ["DAY", "MONTH", "YEAR", "NONE"] as const satisfies readonly LodgingDatePrecision[];

export interface TimedStay {
  checkIn: Date | null;
  checkOut: Date | null;
  datePrecision: string;
  /** Explicit night count, for when the dates cannot supply one. */
  nights: number | null;
}

export interface StayTiming {
  precision: LodgingDatePrecision;
  /** Resolved night count; 0 when nothing in the record says. */
  nights: number;
  /**
   * Whether `nights` rests on anything. Distinguishes "a same-day stay, 0
   * nights" from "nobody knows" — both are 0, and an average over the second
   * is a different claim from an average over the first.
   */
  nightsKnown: boolean;
  /**
   * The date to attribute the stay to for year/month bucketing. Null at NONE
   * precision. At MONTH/YEAR precision it is a placeholder whose day (and, at
   * YEAR, month) means nothing — `canBucketByMonth` says which parts are safe.
   */
  anchor: Date | null;
  /**
   * True only for DAY precision with BOTH ends present: the one case where
   * walking the stay day by day is honest. Gates the weekday histogram, the
   * nights-away set, the travel account and trip coverage.
   */
  walkable: boolean;
  /** Safe to place in a year series (DAY, MONTH or YEAR precision with an anchor). */
  canBucketByYear: boolean;
  /** Safe to place in a month series (DAY or MONTH precision with an anchor). */
  canBucketByMonth: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizePrecision(raw: string, hasAnyDate: boolean): LodgingDatePrecision {
  // No dates can only mean NONE, whatever the column says — a row whose dates
  // were cleared without its precision being updated must not claim DAY.
  if (!hasAnyDate) return "NONE";
  return (LODGING_DATE_PRECISIONS as readonly string[]).includes(raw)
    ? (raw as LodgingDatePrecision)
    : "DAY";
}

/** Whole days between two UTC-midnight-pinned dates; the count `walkNights` walks. */
function daySpan(from: Date, to: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.max(0, Math.round((end - start) / DAY_MS));
}

export function resolveStayTiming(stay: TimedStay): StayTiming {
  const hasAnyDate = stay.checkIn !== null || stay.checkOut !== null;
  const precision = normalizePrecision(stay.datePrecision, hasAnyDate);
  const anchor = stay.checkIn ?? stay.checkOut;

  // Both ends, and the day is real: the dates ARE the answer, and they beat the
  // explicit field. Keeping the field as a tie-break would let a stale number
  // outlive an edited date.
  const walkable = precision === "DAY" && stay.checkIn !== null && stay.checkOut !== null;
  if (walkable) {
    return {
      precision,
      nights: daySpan(stay.checkIn!, stay.checkOut!),
      nightsKnown: true,
      anchor,
      walkable: true,
      canBucketByYear: true,
      canBucketByMonth: true,
    };
  }

  // Everything else: only the explicit field can say how long. A MONTH- or
  // YEAR-precision checkOut is as much a placeholder as its checkIn, so the
  // span between them is fiction, not a fallback.
  const explicit = stay.nights !== null && stay.nights >= 0 ? stay.nights : null;
  return {
    precision,
    nights: explicit ?? 0,
    nightsKnown: explicit !== null,
    anchor: precision === "NONE" ? null : anchor,
    walkable: false,
    canBucketByYear: precision !== "NONE" && anchor !== null,
    canBucketByMonth: (precision === "DAY" || precision === "MONTH") && anchor !== null,
  };
}
