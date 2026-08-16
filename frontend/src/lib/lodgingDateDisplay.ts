import { resolveStayTiming, type LodgingDatePrecision } from "../shared/lodgingTiming";
import type { LodgingStay } from "../types/lodging";

/**
 * How a stay's dates are WRITTEN, given how much of them is known.
 *
 * The counterpart to `shared/lodgingTiming.ts`, which decides what the dates
 * may be used for. Both exist so the same question is not answered differently
 * in a chart and in a list: a stay recorded as "July 2011" must not appear as
 * "01.07.2011 – 01.07.2011" anywhere, because a reader would take that for a
 * one-day stay somebody dated exactly.
 */

/** Shape needed to render a period — a `LodgingStay`, or anything with the same four fields. */
export interface DisplayableStay {
  checkIn: string | null;
  checkOut: string | null;
  datePrecision: LodgingDatePrecision | string;
  nights: number | null;
}

function toDate(value: string | null): Date | null {
  if (value === null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Nights as the rollup counts them — dates when they can say, the explicit field otherwise. */
export function stayNights(stay: DisplayableStay): number {
  return resolveStayTiming({
    checkIn: toDate(stay.checkIn),
    checkOut: toDate(stay.checkOut),
    datePrecision: String(stay.datePrecision),
    nights: stay.nights,
  }).nights;
}

/** True when nothing in the record says how long the stay was. */
export function hasUnknownLength(stay: DisplayableStay): boolean {
  return !resolveStayTiming({
    checkIn: toDate(stay.checkIn),
    checkOut: toDate(stay.checkOut),
    datePrecision: String(stay.datePrecision),
    nights: stay.nights,
  }).nightsKnown;
}

export interface StayPeriodParts {
  /** What to show. Never an empty string — an undated stay gets its own wording. */
  label: string;
  /** The precision behind the label, so a caller can style or caveat it. */
  precision: LodgingDatePrecision;
}

/**
 * `t` is passed in rather than imported so this stays a pure function usable
 * from a table cell, a tooltip and a test without a React context.
 */
export function formatStayPeriod(
  stay: DisplayableStay,
  locale: string,
  t: (key: string) => string,
): StayPeriodParts {
  const checkIn = toDate(stay.checkIn);
  const checkOut = toDate(stay.checkOut);
  const timing = resolveStayTiming({
    checkIn,
    checkOut,
    datePrecision: String(stay.datePrecision),
    nights: stay.nights,
  });

  const day = (d: Date): string =>
    d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

  switch (timing.precision) {
    case "DAY": {
      if (checkIn !== null && checkOut !== null) {
        return { label: `${day(checkIn)} – ${day(checkOut)}`, precision: "DAY" };
      }
      // One end only. "from the 14th" and "until the 16th" are different
      // sentences, and rendering either as a range would invent the other.
      if (checkIn !== null) {
        return { label: `${t("lodging:period.from")} ${day(checkIn)}`, precision: "DAY" };
      }
      return { label: `${t("lodging:period.until")} ${day(checkOut!)}`, precision: "DAY" };
    }
    case "MONTH": {
      const anchor = timing.anchor!;
      return {
        label: anchor.toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" }),
        precision: "MONTH",
      };
    }
    case "YEAR":
      return { label: String(timing.anchor!.getUTCFullYear()), precision: "YEAR" };
    case "NONE":
    default:
      return { label: t("lodging:period.unknown"), precision: "NONE" };
  }
}

/** Sort key for a list ordered by date; undated stays sort last, not to the top on a NaN. */
export function staySortKey(stay: Pick<LodgingStay, "checkIn">): number {
  const d = toDate(stay.checkIn);
  return d === null ? Number.NEGATIVE_INFINITY : d.getTime();
}
