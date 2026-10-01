/**
 * Single source of truth for "does this rental count, and how" (spec
 * 2026-10-01-rental-domain-design §7.4). Every rental figure — the list's
 * year filter, the statistics, the upcoming feed — asks here.
 *
 * One status means the rental happened: `completed` (the car is back).
 * `scheduled` and `in_progress` have not finished, `cancelled` never will.
 * A rental counts on the calendar of its STATIONS, never the reader's or UTC.
 *
 * MIRRORED in `frontend/src/shared/rentalCounting.ts`. Change both together.
 */

import { localDay } from "./time/instant";

export const COUNTABLE_RENTAL_STATUSES = ["completed"] as const;

/** The Prisma `where` fragment: `{ userId, ...countableRentalWhere() }`. A fresh object per call. */
export function countableRentalWhere(): { status: { in: string[] } } {
  return { status: { in: [...COUNTABLE_RENTAL_STATUSES] } };
}

export function isCountableRental(rental: { status: string }): boolean {
  return (COUNTABLE_RENTAL_STATUSES as readonly string[]).includes(rental.status);
}

export interface DatedRental {
  pickupTime: Date;
  returnTime: Date;
  pickupTimezone: string;
  returnTimezone: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two `YYYY-MM-DD` keys (both read as UTC midnights — pure date arithmetic). */
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round(
    (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS
  );
}

/**
 * Rental days: the calendar days from the pickup day (at the pickup station)
 * to the return day (at the return station) — Monday to Wednesday is two,
 * the way a counter bills it; a same-day rental is one, never zero.
 */
export function rentalDays(rental: DatedRental): number {
  const from = localDay(rental.pickupTime, rental.pickupTimezone);
  const to = localDay(rental.returnTime, rental.returnTimezone);
  return Math.max(1, daysBetween(from, to));
}

/** The year a rental is filed under: the year it was PICKED UP, on its station's calendar. */
export function rentalYear(rental: Pick<DatedRental, "pickupTime" | "pickupTimezone">): number {
  return Number(localDay(rental.pickupTime, rental.pickupTimezone).slice(0, 4));
}

/** The countries a rental proves: the two stations', when known (D8 a). Never guessed. */
export function rentalCountries(rental: {
  pickupCountry: string | null;
  returnCountry: string | null;
}): string[] {
  const codes = [rental.pickupCountry, rental.returnCountry]
    .filter((c): c is string => typeof c === "string" && /^[A-Za-z]{2}$/.test(c))
    .map((c) => c.toUpperCase());
  return [...new Set(codes)];
}

/**
 * The amount a rental cost (D10 b): the invoice's final amount when there is
 * one, else the booked price; null when neither is known — out of every
 * average, never a zero. `source` says which one it is.
 */
export function rentalCost(rental: {
  price: number | null;
  currency: string | null;
  finalAmount: number | null;
  finalCurrency: string | null;
}): { amount: number; currency: string; source: "final" | "booked" } | null {
  if (rental.finalAmount !== null && rental.finalCurrency) {
    return { amount: rental.finalAmount, currency: rental.finalCurrency, source: "final" };
  }
  if (rental.price !== null && rental.currency) {
    return { amount: rental.price, currency: rental.currency, source: "booked" };
  }
  return null;
}
