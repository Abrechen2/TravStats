import type { RentalBooking, RentalInvoiceFee, RentalInvoiceReading } from "../../types/rental";

/**
 * An invoice's single fee lines in the review (forgejo#237): each one shown
 * with its amount, marked when the rental already holds it, and taken over
 * on its own. The lines are part of the final amount — they explain the
 * difference to the booked price and are never added to anything.
 */

export interface InvoiceFeeRow extends RentalInvoiceFee {
  index: number;
  /** The rental already holds this line (same label, amount and currency). */
  recorded: boolean;
}

const sameFee = (a: RentalInvoiceFee, b: RentalInvoiceFee): boolean =>
  a.label === b.label && a.amount === b.amount && a.currency === b.currency;

export function invoiceFeeRows(
  rental: Pick<RentalBooking, "invoiceFees"> | null,
  invoice: Pick<RentalInvoiceReading, "fees">
): InvoiceFeeRow[] {
  const stored = rental?.invoiceFees ?? [];
  return (invoice.fees ?? []).map((fee, index) => ({
    ...fee,
    index,
    recorded: stored.some((s) => sameFee(s, fee)),
  }));
}

/** The lines' total, or null when they are in more than one currency (nothing is converted). */
export function feesTotal(
  fees: readonly RentalInvoiceFee[]
): { amount: number; currency: string } | null {
  if (fees.length === 0) return null;
  const currency = fees[0].currency;
  if (fees.some((f) => f.currency !== currency)) return null;
  const cents = fees.reduce((sum, f) => sum + Math.round(f.amount * 100), 0);
  return { amount: cents / 100, currency };
}

/** The indexes the review took over, for `adopt.fees`. */
export function pickedFeeIndexes(picks: readonly boolean[]): number[] {
  return picks.flatMap((picked, index) => (picked ? [index] : []));
}
