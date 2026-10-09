import type { RentalBooking } from "../../types/rental";

/**
 * Booked price, final amount and their difference, side by side (forgejo#237).
 *
 * The two amounts are never added: the rental COSTS one of them (`cost`, the
 * server's `rentalCost` — the invoice's amount when there is one), and the
 * other stays on the row only to be compared. A difference is a subtraction
 * in ONE currency; across two currencies there is none, and the comparison
 * says so rather than converting silently. Each amount names its origin.
 */
export interface PriceComparison {
  booked: { amount: number; currency: string; source: "booking" | "user" | null } | null;
  final: {
    amount: number;
    currency: string;
    source: "invoice" | "user" | "cancellationFee" | null;
  } | null;
  /** final − booked, same currency only; positive = the invoice asked for more. */
  difference: { amount: number; currency: string } | null;
  /** Why there is no difference: an amount is missing, or the currencies differ. */
  noDifference: "missing" | "currency" | null;
  /** Which of the two the rental's cost counts. */
  counts: "final" | "booked" | "cancellationFee" | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function rentalPriceComparison(
  rental: Pick<
    RentalBooking,
    | "price"
    | "currency"
    | "priceSource"
    | "finalAmount"
    | "finalCurrency"
    | "finalAmountSource"
    | "cost"
  >
): PriceComparison {
  const booked =
    rental.price !== null && rental.currency
      ? { amount: rental.price, currency: rental.currency, source: rental.priceSource }
      : null;
  const final =
    rental.finalAmount !== null && rental.finalCurrency
      ? {
          amount: rental.finalAmount,
          currency: rental.finalCurrency,
          source: rental.finalAmountSource,
        }
      : null;
  const comparable = booked !== null && final !== null && booked.currency === final.currency;
  return {
    booked,
    final,
    difference: comparable
      ? { amount: round2(final.amount - booked.amount), currency: final.currency }
      : null,
    noDifference: comparable ? null : booked && final ? "currency" : "missing",
    counts: rental.cost?.source ?? null,
  };
}
