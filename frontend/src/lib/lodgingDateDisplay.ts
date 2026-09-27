import { resolveStayTiming, type LodgingDatePrecision } from "../shared/lodgingTiming";
import type { LodgingStay } from "../types/lodging";
import type { StayTimes } from "../types/times";
import { formatLocalDate } from "./displayFormat";
import { stayCheckIn, stayCheckOut } from "./entityTimes";

/**
 * How a stay's dates are WRITTEN, given how much of them is known.
 *
 * The counterpart to `shared/lodgingTiming.ts`, which decides what the dates
 * may be used for. Both exist so the same question is not answered differently
 * in a chart and in a list: a stay recorded as "July 2011" must not appear as
 * "01.07.2011 – 01.07.2011" anywhere, because a reader would take that for a
 * one-day stay somebody dated exactly.
 *
 * The days are the HOTEL's (`times.checkIn.date`, ADR 0002) — `YYYY-MM-DD`
 * strings, read through `lib/entityTimes.ts`. No zone is consulted, so no
 * reader west of UTC sees the day before.
 */

/** Shape needed to render a period — a `LodgingStay`, or anything with the same four fields. */
export interface DisplayableStay {
  checkIn: string | null;
  checkOut: string | null;
  datePrecision: LodgingDatePrecision | string;
  nights: number | null;
  times?: StayTimes;
}

/** A `YYYY-MM-DD` day as the UTC midnight `resolveStayTiming` computes with. */
function toDate(day: string | null | undefined): Date | null {
  if (!day) return null;
  const d = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const checkInDay = (stay: DisplayableStay): string | null => stayCheckIn(stay)?.date ?? null;
const checkOutDay = (stay: DisplayableStay): string | null => stayCheckOut(stay)?.date ?? null;

/** Nights as the rollup counts them — dates when they can say, the explicit field otherwise. */
export function stayNights(stay: DisplayableStay): number {
  return resolveStayTiming({
    checkIn: toDate(checkInDay(stay)),
    checkOut: toDate(checkOutDay(stay)),
    datePrecision: String(stay.datePrecision),
    nights: stay.nights,
  }).nights;
}

/** True when nothing in the record says how long the stay was. */
export function hasUnknownLength(stay: DisplayableStay): boolean {
  return !resolveStayTiming({
    checkIn: toDate(checkInDay(stay)),
    checkOut: toDate(checkOutDay(stay)),
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
  t: (key: string) => string
): StayPeriodParts {
  const inDay = checkInDay(stay);
  const outDay = checkOutDay(stay);
  const checkIn = toDate(inDay);
  const checkOut = toDate(outDay);
  const timing = resolveStayTiming({
    checkIn,
    checkOut,
    datePrecision: String(stay.datePrecision),
    nights: stay.nights,
  });

  // The user's date format (Settings → Display). `locale` still names the month
  // for a month-precision stay below, where there is no day order to choose.
  const day = (d: string): string => formatLocalDate(d);

  switch (timing.precision) {
    case "DAY": {
      if (inDay !== null && outDay !== null) {
        return { label: `${day(inDay)} – ${day(outDay)}`, precision: "DAY" };
      }
      // One end only. "from the 14th" and "until the 16th" are different
      // sentences, and rendering either as a range would invent the other.
      if (inDay !== null) {
        return { label: `${t("lodging:period.from")} ${day(inDay)}`, precision: "DAY" };
      }
      return { label: `${t("lodging:period.until")} ${day(outDay ?? "")}`, precision: "DAY" };
    }
    case "MONTH": {
      const anchor = timing.anchor!;
      return {
        label: anchor.toLocaleDateString(locale, {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }),
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

type DisplayableStayTimes = Pick<DisplayableStay, "times">;

/** Sort key for a list ordered by date; undated stays sort last, not to the top on a NaN. */
export function staySortKey(
  stay: Pick<LodgingStay, "checkIn" | "checkOut"> & DisplayableStayTimes
): number {
  const d = toDate(stayCheckIn(stay)?.date);
  return d === null ? Number.NEGATIVE_INFINITY : d.getTime();
}
